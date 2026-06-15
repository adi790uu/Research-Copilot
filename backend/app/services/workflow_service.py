"""Orchestrates a research run.

`start_run` returns immediately after kicking off an `asyncio.create_task`. The
task drives the LangGraph workflow, emits per-node events to the bus, and on
completion persists the report and flips session.status.
"""

from __future__ import annotations

import asyncio
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver

from app.core.config import get_settings
from app.core.errors import AppError, NotFoundError
from app.core.logging import get_logger
from app.domain.events import ReportReady, RunFailed, RunStarted
from app.persistence.db import get_sessionmaker
from app.persistence.repositories import ReportRepository, SessionRepository
from app.providers.factory import build_providers
from app.services.event_bus import WorkflowEventBus
from app.workflow.deps import WorkflowDeps
from app.workflow.graph import build_graph

log = get_logger(__name__)


class RunAlreadyInFlightError(AppError):
    status_code = 409
    code = "run_already_in_flight"


class WorkflowService:
    """One instance per process; bound to app.state."""

    def __init__(self, *, bus: WorkflowEventBus, checkpointer: BaseCheckpointSaver) -> None:
        self._bus = bus
        self._checkpointer = checkpointer
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def is_running(self, session_id: str) -> bool:
        task = self._tasks.get(session_id)
        return task is not None and not task.done()

    async def start_run(self, *, session_id: str, user_id: str) -> None:
        if self.is_running(session_id):
            raise RunAlreadyInFlightError(f"Run for session {session_id} is already in flight")

        # Verify session ownership and snapshot inputs before flipping status.
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            repo = SessionRepository(db, user_id)
            row = await repo.get(session_id)
            if row is None:
                raise NotFoundError(f"Session {session_id} not found")
            company_name = row.company_name
            website = row.website
            objective = row.objective
            await repo.set_status(session_id, "running")
            await db.commit()

        # Clear retained events from any prior run on this session.
        await self._bus.reset(session_id)

        task = asyncio.create_task(
            self._run(
                session_id=session_id,
                user_id=user_id,
                company_name=company_name,
                website=website,
                objective=objective,
            ),
            name=f"workflow-{session_id}",
        )
        self._tasks[session_id] = task
        task.add_done_callback(lambda t: self._tasks.pop(session_id, None))

    async def _run(
        self,
        *,
        session_id: str,
        user_id: str,
        company_name: str,
        website: str,
        objective: str,
    ) -> None:
        settings = get_settings()
        llm, search = build_providers(settings, company_hint=company_name)
        deps = WorkflowDeps(
            llm=llm,
            search=search,
            search_results_per_query=settings.workflow_search_results_per_query,
            emit=self._bus.publish,
        )
        graph = build_graph(deps, checkpointer=self._checkpointer)

        await self._bus.publish(RunStarted(session_id=session_id))

        initial: dict[str, Any] = {
            "session_id": session_id,
            "company_name": company_name,
            "website": website,
            "objective": objective,
            "max_attempts": settings.workflow_max_attempts,
            "attempt": 0,
        }
        config = {"configurable": {"thread_id": session_id}}

        try:
            final = await graph.ainvoke(initial, config=config)
        except Exception as exc:  # noqa: BLE001 — terminal failure, surface as event
            log.exception("workflow_run_failed", session_id=session_id)
            await self._fail(session_id, user_id, str(exc))
            return

        report_content = final.get("report")
        if report_content is None:
            await self._fail(session_id, user_id, "Workflow finished without a report")
            return

        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            sessions = SessionRepository(db, user_id)
            owned = await sessions.get(session_id)
            if owned is None:
                # User was deleted mid-run, or session was. Bail without persisting.
                await self._fail(session_id, user_id, "Session disappeared mid-run")
                return
            reports = ReportRepository(db)
            row = await reports.upsert(
                session_id=session_id, content=report_content.model_dump(mode="json")
            )
            await sessions.set_status(session_id, "completed")
            await db.commit()
            report_id = row.id

        await self._bus.publish(ReportReady(session_id=session_id, report_id=report_id))

    async def _fail(self, session_id: str, user_id: str, message: str) -> None:
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            await SessionRepository(db, user_id).set_status(session_id, "failed")
            await db.commit()
        await self._bus.publish(RunFailed(session_id=session_id, message=message))
