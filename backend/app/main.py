import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import chats, health, sessions, users, workflow
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, get_logger
from app.persistence.checkpointer import checkpointer_lifespan
from app.persistence.db import dispose_db, init_db
from app.services.event_bus import WorkflowEventBus
from app.services.workflow_service import WorkflowService


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
        app.state.event_bus = WorkflowEventBus()
        app.state.workflow_service = WorkflowService(
            bus=app.state.event_bus, checkpointer=saver
        )
        log.info("checkpointer_ready")
        try:
            yield
        finally:
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
    app.include_router(users.router)
    app.include_router(sessions.router)
    app.include_router(workflow.router)
    app.include_router(chats.router)

    return app


app = create_app()
