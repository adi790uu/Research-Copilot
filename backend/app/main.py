import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, briefs, copilot, health, users, workflow
from app.copilot.graph import build_graph as build_copilot_graph
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, get_logger
from app.persistence.checkpointer import checkpointer_lifespan
from app.persistence.db import dispose_db, init_db
from app.services import hubspot_sync
from app.services.workflow_service import WorkflowService


async def _hubspot_poll_loop(workflow_service: WorkflowService) -> None:
    settings = get_settings()
    log = get_logger(__name__)
    while True:
        try:
            await hubspot_sync.run_sync_cycle(workflow_service)
        except Exception:  # noqa: BLE001
            log.exception("hubspot_sync_cycle_failed")
        await asyncio.sleep(settings.hubspot_poll_interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    log = get_logger(__name__)
    log.info("startup", env="dev")
    await init_db()
    log.info("db_ready")
    async with checkpointer_lifespan() as saver:
        app.state.checkpointer = saver
        app.state.workflow_service = WorkflowService(checkpointer=saver)
        app.state.copilot_graph = build_copilot_graph(checkpointer=saver)
        log.info("checkpointer_ready")

        poll_task: asyncio.Task | None = None
        if settings.hubspot_access_token and settings.hubspot_deal_stage_id:
            poll_task = asyncio.create_task(_hubspot_poll_loop(app.state.workflow_service))
            log.info("hubspot_sync_started", interval_s=settings.hubspot_poll_interval_seconds)

        try:
            yield
        finally:
            if poll_task is not None:
                poll_task.cancel()
            await dispose_db()
            log.info("shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Research Copilot",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id, path=request.url.path)
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response

    register_error_handlers(app)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(briefs.router)
    app.include_router(workflow.router)
    app.include_router(workflow.jobs_router)
    app.include_router(copilot.router)

    return app


app = create_app()
