"""Orchestrates a company-research run.

Drives the LangGraph in three phases:
  1. `start_run` kicks off a background task. The graph either pauses at
     clarify_with_user (ClarificationRequested) or hits interrupt_after at
     create_research_plan (PlanReady).
  2. `submit_clarifications` resumes after a clarification pause by injecting
     the user's answers and re-driving the same thread.
  3. `approve_plan` resumes after the plan_ready interrupt and runs the rest
     of the graph (supervisor + final_report) to completion.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.base import BaseCheckpointSaver

from app.core.config import get_settings
from app.core.errors import AppError, NotFoundError
from app.core.logging import get_logger
from app.domain.events import (
    ClarificationRequested,
    PlanReady,
    ReportReady,
    RunFailed,
    RunStarted,
)
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

    # ----- public entry points ----------------------------------------------

    async def start_run(self, *, session_id: str, user_id: str) -> None:
        if self.is_running(session_id):
            raise RunAlreadyInFlightError(f"Run for session {session_id} is already in flight")

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

        await self._bus.reset(session_id)
        self._spawn(
            session_id=session_id,
            user_id=user_id,
            kind="initial",
            extra={
                "company_name": company_name,
                "website": website,
                "objective": objective,
            },
        )

    async def submit_clarifications(
        self, *, session_id: str, user_id: str, answers: list[str]
    ) -> None:
        """Resume after a clarification pause by re-running with the user's answers
        appended to the original message thread."""
        if self.is_running(session_id):
            raise RunAlreadyInFlightError(f"Run for session {session_id} is already in flight")

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

        await self._bus.reset(session_id)
        self._spawn(
            session_id=session_id,
            user_id=user_id,
            kind="initial",
            extra={
                "company_name": company_name,
                "website": website,
                "objective": objective,
                "clarification_answers": answers,
            },
        )

    async def approve_plan(self, *, session_id: str, user_id: str) -> None:
        """Resume after the create_research_plan interrupt; finishes the run."""
        if self.is_running(session_id):
            raise RunAlreadyInFlightError(f"Run for session {session_id} is already in flight")

        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            repo = SessionRepository(db, user_id)
            row = await repo.get(session_id)
            if row is None:
                raise NotFoundError(f"Session {session_id} not found")
            await repo.set_status(session_id, "running")
            await db.commit()

        # Do NOT bus.reset — keep the prior events so the SSE replay still has
        # the run_started/plan_ready timeline.
        self._spawn(session_id=session_id, user_id=user_id, kind="resume", extra={})

    # ----- internals --------------------------------------------------------

    def _spawn(
        self, *, session_id: str, user_id: str, kind: str, extra: dict[str, Any]
    ) -> None:
        task = asyncio.create_task(
            self._run(session_id=session_id, user_id=user_id, kind=kind, extra=extra),
            name=f"workflow-{session_id}",
        )
        self._tasks[session_id] = task
        task.add_done_callback(lambda t: self._tasks.pop(session_id, None))

    async def _run(
        self,
        *,
        session_id: str,
        user_id: str,
        kind: str,
        extra: dict[str, Any],
    ) -> None:
        settings = get_settings()
        company_name = extra.get("company_name", "")
        llm, search = build_providers(settings, company_hint=company_name)
        deps = WorkflowDeps(llm=llm, search=search, emit=self._bus.publish)
        graph = build_graph(deps, checkpointer=self._checkpointer)

        runnable_config = {
            "configurable": {
                "thread_id": session_id,
                "search_provider": search,
                "company_name": company_name,
                "website": extra.get("website", ""),
                "allow_clarification": settings.workflow_allow_clarification,
            }
        }

        if kind == "initial":
            await self._bus.publish(RunStarted(session_id=session_id))
            seed = self._initial_messages(extra)
            initial_state: dict[str, Any] = {
                "messages": seed,
                "session_id": session_id,
                "company_name": company_name,
                "website": extra.get("website", ""),
                "objective": extra.get("objective", ""),
                "supervisor_messages": {"type": "override", "value": []},
                "notes": {"type": "override", "value": []},
                "raw_notes": {"type": "override", "value": []},
            }
            try:
                await graph.ainvoke(initial_state, config=runnable_config)
            except Exception as exc:  # noqa: BLE001
                log.exception("workflow_run_failed", session_id=session_id)
                await self._fail(session_id, user_id, str(exc))
                return
        elif kind == "resume":
            try:
                await graph.ainvoke(None, config=runnable_config)
            except Exception as exc:  # noqa: BLE001
                log.exception("workflow_resume_failed", session_id=session_id)
                await self._fail(session_id, user_id, str(exc))
                return
        else:
            await self._fail(session_id, user_id, f"unknown run kind {kind}")
            return

        # Where did we land?
        try:
            snapshot = await graph.aget_state(runnable_config)
        except Exception as exc:  # noqa: BLE001
            log.exception("aget_state failed", session_id=session_id)
            await self._fail(session_id, user_id, str(exc))
            return

        next_nodes = snapshot.next if snapshot else ()
        values: dict[str, Any] = (snapshot.values if snapshot else {}) or {}

        # Interrupt at create_research_plan -> emit PlanReady, auto-approve if configured.
        if next_nodes and "research_supervisor" in next_nodes:
            # `research_plan` is now stored as a plain dict (see state.py and
            # nodes/research_plan.py) — no model_dump needed.
            plan = values.get("research_plan") or {}
            await self._bus.publish(PlanReady(session_id=session_id, plan=plan))

            if settings.workflow_auto_approve_plan:
                # Continue immediately on the same thread.
                try:
                    await graph.ainvoke(None, config=runnable_config)
                except Exception as exc:  # noqa: BLE001
                    log.exception("auto-approve resume failed", session_id=session_id)
                    await self._fail(session_id, user_id, str(exc))
                    return
                # Re-fetch state for the final branch below.
                snapshot = await graph.aget_state(runnable_config)
                values = (snapshot.values if snapshot else {}) or {}
                next_nodes = snapshot.next if snapshot else ()
            else:
                await self._set_status(session_id, user_id, "awaiting_plan_approval")
                return

        # Clarification path: graph ended without producing a report; last AIMessage
        # carries the clarification JSON.
        if values.get("report") is None and not next_nodes:
            clarification = _extract_clarification(values)
            if clarification is not None:
                await self._bus.publish(
                    ClarificationRequested(session_id=session_id, questions=clarification)
                )
                await self._set_status(session_id, user_id, "awaiting_clarification")
                return
            await self._fail(session_id, user_id, "Workflow ended without a report or clarification")
            return

        # Terminal success path.
        report_content = values.get("report")
        if report_content is None:
            await self._fail(session_id, user_id, "Workflow finished without a report")
            return

        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            sessions = SessionRepository(db, user_id)
            owned = await sessions.get(session_id)
            if owned is None:
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

    def _initial_messages(self, extra: dict[str, Any]) -> list[Any]:
        company_name = extra.get("company_name", "")
        website = extra.get("website", "")
        objective = extra.get("objective", "")
        intro = (
            f"Company: {company_name}\n"
            f"Website: {website}\n"
            f"Objective: {objective}"
        )
        msgs: list[Any] = [HumanMessage(content=intro)]
        for ans in extra.get("clarification_answers", []) or []:
            msgs.append(HumanMessage(content=ans))
        return msgs

    async def _set_status(self, session_id: str, user_id: str, status: str) -> None:
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            await SessionRepository(db, user_id).set_status(session_id, status)
            await db.commit()

    async def _fail(self, session_id: str, user_id: str, message: str) -> None:
        await self._set_status(session_id, user_id, "failed")
        await self._bus.publish(RunFailed(session_id=session_id, message=message))


def _extract_clarification(values: dict[str, Any]) -> list[dict[str, Any]] | None:
    """If the graph terminated at clarify_with_user, the last AI message holds a
    JSON payload `{"type":"clarification","questions":[...]}`."""
    messages = values.get("messages", []) or []
    for msg in reversed(messages):
        if isinstance(msg, AIMessage):
            content = msg.content if isinstance(msg.content, str) else None
            if not content:
                return None
            try:
                parsed = json.loads(content)
            except (json.JSONDecodeError, TypeError):
                return None
            if isinstance(parsed, dict) and parsed.get("type") == "clarification":
                return list(parsed.get("questions", []) or [])
            return None
    return None
