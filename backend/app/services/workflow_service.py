"""Orchestrates a company-research run.

Two phases:

1. **Phase 1 (foreground)** — clarify → brief → plan. Drives the graph
   inline so the caller can stream events out as SSE. Closes when the
   graph pauses (clarification needed) or the plan is ready.

2. **Phase 2 (external worker)** — supervisor + researchers + report. Kicked
   off by `approve_plan`, which creates a `ResearchJob` row and triggers the
   TypeScript Trigger.dev worker. The frontend polls `/jobs/{id}` until the
   job is completed or failed.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver

from app.core.config import get_settings
from app.core.errors import AppError, NotFoundError
from app.core.logging import get_logger
from app.domain.events import (
    ClarificationRequested,
    NodeCompleted,
    NodeName,
    NodeStarted,
    PlanReady,
    RunFailed,
    RunStarted,
    WorkflowEvent,
)
from app.persistence.db import get_sessionmaker
from app.persistence.repositories import SessionRepository
from app.services import job_store
from app.services.worker_trigger import trigger_research_worker
from app.workflow.graph import build_graph

log = get_logger(__name__)


_PHASE1_NODES = {
    "clarify_with_user",
    "write_research_brief",
    "create_research_plan",
}


class WorkflowService:
    """One instance per process; bound to app.state."""

    def __init__(self, *, checkpointer: BaseCheckpointSaver) -> None:
        self._checkpointer = checkpointer

    # ----- builders ---------------------------------------------------------

    def _build(
        self, *, session_id: str, company_name: str, website: str
    ) -> tuple[Any, RunnableConfig]:
        """Build the LangGraph + RunnableConfig for a session.

        Graph 1 (clarify → brief → plan) reads its model from config via
        `helpers._create_model`, so there's nothing to inject here.
        """
        settings = get_settings()
        graph = build_graph(checkpointer=self._checkpointer)
        config: RunnableConfig = {
            "configurable": {
                "thread_id": session_id,
                "company_name": company_name,
                "website": website,
                "allow_clarification": settings.workflow_allow_clarification,
            }
        }
        return graph, config

    # ----- session lookup ---------------------------------------------------

    async def _load_session(self, *, session_id: str, user_id: str) -> tuple[str, str, str]:
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            row = await SessionRepository(db, user_id).get(session_id)
            if row is None:
                raise NotFoundError(f"Session {session_id} not found")
            return row.company_name, row.website, row.objective

    async def _set_status(self, *, session_id: str, user_id: str, status: str) -> None:
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            await SessionRepository(db, user_id).set_status(session_id, status)
            await db.commit()

    # ----- phase 1 (foreground) --------------------------------------------

    async def run_phase1(
        self,
        *,
        session_id: str,
        user_id: str,
        message: str | None = None,
    ) -> AsyncIterator[WorkflowEvent]:
        """Drive phase 1 (clarify → brief → plan), yielding events as they happen.

        `message` is the user's turn:
        - `None` on the first call (the seed Company/Website/Objective message
          is built from the session row).
        - A clarification answer on subsequent calls; appended as a new
          HumanMessage to the checkpointed history.

        Stops when the graph pauses at:
        - `clarify_with_user` (ClarificationRequested)
        - `create_research_plan` (PlanReady, via interrupt_after)
        - Or terminates with `final_report` already set (unlikely in phase 1).
        """
        company_name, website, objective = await self._load_session(
            session_id=session_id, user_id=user_id
        )
        graph, config = self._build(
            session_id=session_id, company_name=company_name, website=website
        )

        await self._set_status(session_id=session_id, user_id=user_id, status="running")

        # Build the input to ainvoke based on whether this is the first turn.
        input_state: dict[str, Any] | None
        if message is None:
            snapshot = await graph.aget_state(config)
            has_prior = bool(snapshot and snapshot.values)
            if has_prior:
                # Resume an in-progress run without injecting a new message —
                # treat as a "subscribe" so we don't double-seed.
                input_state = None
            else:
                intro = (
                    f"Company: {company_name}\n"
                    f"Website: {website}\n"
                    f"Objective: {objective}"
                )
                input_state = {
                    "messages": [HumanMessage(content=intro)],
                    "session_id": session_id,
                    "company_name": company_name,
                    "website": website,
                    "objective": objective,
                }
        else:
            input_state = {"messages": [HumanMessage(content=message.strip())]}

        return _phase1_event_iter(
            graph=graph,
            config=config,
            input_state=input_state,
            session_id=session_id,
            user_id=user_id,
            set_status=self._set_status,
        )

    # ----- phase 2 (external worker) ---------------------------------------

    async def approve_plan(self, *, session_id: str, user_id: str) -> str:
        """Create a ResearchJob and trigger the external worker. Returns job_id.

        Reads the approved plan off the checkpoint, persists it on a new job
        row, then dispatches the Trigger.dev worker. If dispatch fails the job
        is marked failed so the caller sees a clear error.
        """
        company_name, website, _ = await self._load_session(
            session_id=session_id, user_id=user_id
        )
        graph, config = self._build(
            session_id=session_id, company_name=company_name, website=website
        )

        snapshot = await graph.aget_state(config)
        values: dict[str, Any] = (snapshot.values if snapshot else {}) or {}
        plan = values.get("research_plan") or {}
        if not plan:
            raise AppError("No research plan is ready to approve for this session")
        plan_text = json.dumps(plan)

        job_id = await job_store.create_job(
            session_id=session_id, user_id=user_id, research_plan=plan_text
        )
        try:
            await trigger_research_worker(
                job_id=job_id,
                session_id=session_id,
                user_id=user_id,
                research_plan=plan_text,
            )
        except Exception as exc:  # noqa: BLE001
            await job_store.update_job_status(job_id, "failed")
            raise AppError(f"Could not trigger research worker: {exc}") from exc

        await self._set_status(session_id=session_id, user_id=user_id, status="running")
        return job_id

    # ----- plan editing (no run) -------------------------------------------

    async def save_plan_edits(
        self, *, session_id: str, user_id: str, plan: dict[str, Any]
    ) -> dict[str, Any]:
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            repo = SessionRepository(db, user_id)
            row = await repo.get(session_id)
            if row is None:
                raise NotFoundError(f"Session {session_id} not found")
            if row.status != "awaiting_plan_approval":
                raise AppError(
                    f"Plan can only be edited while awaiting approval; "
                    f"current status: {row.status}"
                )
            company_name = row.company_name
            website = row.website

        graph, config = self._build(
            session_id=session_id, company_name=company_name, website=website
        )
        await graph.aupdate_state(config, {"research_plan": plan})
        return plan


# ---------- phase-1 streaming generator -------------------------------------


async def _phase1_event_iter(
    *,
    graph: Any,
    config: RunnableConfig,
    input_state: dict[str, Any] | None,
    session_id: str,
    user_id: str,
    set_status: Any,
) -> AsyncIterator[WorkflowEvent]:
    """Stream phase-1 events from the LangGraph.

    Tails `astream(stream_mode="updates")` and emits a `NodeStarted` +
    `NodeCompleted` pair per phase-1 node update. The stream stops when:
      - The graph terminates with a research plan ready. The session is
        marked `awaiting_plan_approval` and `PlanReady{plan}` is yielded
        (no job_id yet — approval creates it). The frontend then
        edits/approves via `POST /sessions/{id}/plan/approve`.
      - `clarify_with_user` ends the run with a clarification marker.
      - Or it raises, in which case RunFailed is yielded.
    """
    yield RunStarted(session_id=session_id)
    started = time.perf_counter()
    clarification_emitted = False

    try:
        async for stream_data in graph.astream(input_state, config, stream_mode="updates"):
            if not isinstance(stream_data, dict):
                continue
            for node_key, node_update in stream_data.items():
                if node_key not in _PHASE1_NODES:
                    continue
                node_name: NodeName = node_key  # type: ignore[assignment]
                yield NodeStarted(session_id=session_id, node=node_name)
                elapsed_ms = int((time.perf_counter() - started) * 1000)
                yield NodeCompleted(
                    session_id=session_id,
                    node=node_name,
                    duration_ms=max(0, elapsed_ms),
                )
                started = time.perf_counter()

                if (
                    node_key == "clarify_with_user"
                    and isinstance(node_update, dict)
                    and not clarification_emitted
                ):
                    marker = _extract_clarify_marker(node_update.get("messages") or [])
                    if marker and marker.get("type") == "clarification":
                        clarification_emitted = True
                        yield ClarificationRequested(
                            session_id=session_id,
                            questions=list(marker.get("questions", []) or []),
                        )
                        await set_status(
                            session_id=session_id,
                            user_id=user_id,
                            status="awaiting_clarification",
                        )
                        return
    except Exception as exc:  # noqa: BLE001
        log.exception("phase1_failed", session_id=session_id)
        await set_status(session_id=session_id, user_id=user_id, status="failed")
        yield RunFailed(session_id=session_id, message=str(exc))
        return

    # Stream ended — figure out where we landed.
    try:
        snapshot = await graph.aget_state(config)
    except Exception as exc:  # noqa: BLE001
        log.exception("phase1_aget_state_failed", session_id=session_id)
        await set_status(session_id=session_id, user_id=user_id, status="failed")
        yield RunFailed(session_id=session_id, message=str(exc))
        return

    values: dict[str, Any] = (snapshot.values if snapshot else {}) or {}

    plan = values.get("research_plan")
    if plan:
        # Graph 1 done: hold for the user to review/approve. Phase 2 is
        # kicked off out-of-band by POST /sessions/{id}/plan/approve.
        await set_status(
            session_id=session_id, user_id=user_id, status="awaiting_plan_approval"
        )
        yield PlanReady(session_id=session_id, plan=plan)
        return

    # Graph terminated without hitting plan or clarification — either
    # clarification already handled (we returned above) or something
    # unexpected. Surface the last AI message for visibility.
    marker = _extract_clarify_marker(values.get("messages") or [])
    if marker and marker.get("type") == "clarification" and not clarification_emitted:
        yield ClarificationRequested(
            session_id=session_id,
            questions=list(marker.get("questions", []) or []),
        )
        await set_status(
            session_id=session_id, user_id=user_id, status="awaiting_clarification"
        )
        return

    # Should not happen in phase 1, but don't deadlock the stream.
    await set_status(session_id=session_id, user_id=user_id, status="failed")
    yield RunFailed(session_id=session_id, message="Phase 1 ended in an unexpected state")


def _extract_clarify_marker(messages: list) -> dict[str, Any] | None:
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
                return parsed
            return None
    return None
