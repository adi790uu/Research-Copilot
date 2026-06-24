"""Orchestrates a company-research run.

Two phases:

1. **Phase 1 (foreground)** — clarify → brief → plan. Drives the graph inline
   so the caller can stream events out as SSE. Phase 1 is message-driven: the
   caller passes the user's turn as text (the first turn is the labeled
   Company/Website/Objective block built client-side); everything else lives in
   the LangGraph checkpoint, so we never read the brief row here.

2. **Phase 2 (external worker)** — supervisor + researchers + report. Kicked off
   by `approve_plan`, which creates a `ResearchJob` row and triggers the
   TypeScript Trigger.dev worker. The frontend polls `/jobs/{id}` until done.
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
from app.persistence.repositories import BriefRepository, MessageRepository
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

    def _build(self, *, brief_id: str) -> tuple[Any, RunnableConfig]:
        """Build the LangGraph + RunnableConfig for a brief thread."""
        settings = get_settings()
        graph = build_graph(checkpointer=self._checkpointer)
        config: RunnableConfig = {
            "configurable": {
                "thread_id": brief_id,
                "allow_clarification": settings.workflow_allow_clarification,
            }
        }
        return graph, config

    # ----- persistence helpers ---------------------------------------------

    async def _set_status(self, *, brief_id: str, user_id: str, status: str) -> None:
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            await BriefRepository(db, user_id).set_status(brief_id, status)
            await db.commit()

    async def _record_user_turn(
        self,
        *,
        brief_id: str,
        user_id: str,
        content: str,
        clarification_answered: bool = False,
        clarification_answers: list[dict] | None = None,
    ) -> None:
        """Store the user message and, when this turn answers the clarification,
        flip + record the answers on the brief — all in one transaction so the
        messages table and the brief's clarification JSON can't diverge."""
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            await MessageRepository(db, brief_id).add(
                role="user", content=content, kind="workflow"
            )
            if clarification_answered:
                await BriefRepository(db, user_id).mark_clarification_answered(
                    brief_id, clarification_answers
                )
            await db.commit()

    async def _store_clarification(self, *, brief_id: str, user_id: str, questions: list[dict]) -> None:
        """Persist the gate's questions on the brief (answered=false).

        The clarification is structured state on the brief, not a chat message —
        the frontend renders it from `brief.clarification_question`.
        """
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            await BriefRepository(db, user_id).set_clarification_question(brief_id, questions)
            await db.commit()

    # ----- phase 1 (foreground) --------------------------------------------

    async def run_phase1(
        self,
        *,
        brief_id: str,
        user_id: str,
        message: str | None = None,
        clarification_answered: bool = False,
        clarification_answers: list[dict] | None = None,
    ) -> AsyncIterator[WorkflowEvent]:
        """Drive phase 1 (clarify → brief → plan), yielding events as they happen.

        `message` is the user's turn appended to the checkpointed history:
        - The labeled Company/Website/Objective block on the first turn.
        - A clarification answer on later turns.
        - `None` to subscribe/resume without injecting a turn.

        When `clarification_answered` is set, the brief's clarification gate is
        flipped to answered so the user isn't re-prompted.
        """
        graph, config = self._build(brief_id=brief_id)
        await self._set_status(brief_id=brief_id, user_id=user_id, status="running")

        input_state: dict[str, Any] | None = None
        if message and message.strip():
            text = message.strip()
            await self._record_user_turn(
                brief_id=brief_id,
                user_id=user_id,
                content=text,
                clarification_answered=clarification_answered,
                clarification_answers=clarification_answers,
            )
            input_state = {"messages": [HumanMessage(content=text)]}

        return _phase1_event_iter(
            graph=graph,
            config=config,
            input_state=input_state,
            brief_id=brief_id,
            user_id=user_id,
            set_status=self._set_status,
            store_clarification=self._store_clarification,
        )

    # ----- phase 2 (external worker) ---------------------------------------

    async def approve_plan(self, *, brief_id: str, user_id: str) -> str:
        """Create a ResearchJob and trigger the external worker. Returns job_id.

        Reads the approved plan off the checkpoint, persists it on a new job
        row, then dispatches the Trigger.dev worker. If dispatch fails the job
        is marked failed so the caller sees a clear error.
        """
        graph, config = self._build(brief_id=brief_id)

        snapshot = await graph.aget_state(config)
        values: dict[str, Any] = (snapshot.values if snapshot else {}) or {}
        plan = values.get("research_plan") or {}
        if not plan:
            raise AppError("No research plan is ready to approve for this brief")
        plan_text = json.dumps(plan)

        job_id = await job_store.create_job(
            brief_id=brief_id, user_id=user_id, research_plan=plan_text
        )
        try:
            await trigger_research_worker(
                job_id=job_id,
                brief_id=brief_id,
                user_id=user_id,
                research_plan=plan_text,
            )
        except Exception as exc:  # noqa: BLE001
            await job_store.update_job_status(job_id, "failed")
            raise AppError(f"Could not trigger research worker: {exc}") from exc

        await self._set_status(brief_id=brief_id, user_id=user_id, status="running")
        return job_id

    # ----- plan editing (no run) -------------------------------------------

    async def save_plan_edits(
        self, *, brief_id: str, user_id: str, plan: dict[str, Any]
    ) -> dict[str, Any]:
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            row = await BriefRepository(db, user_id).get(brief_id)
            if row is None:
                raise NotFoundError(f"Brief {brief_id} not found")
            if row.status != "awaiting_plan_approval":
                raise AppError(
                    f"Plan can only be edited while awaiting approval; "
                    f"current status: {row.status}"
                )

        graph, config = self._build(brief_id=brief_id)
        await graph.aupdate_state(config, {"research_plan": plan})
        return plan


# ---------- phase-1 streaming generator -------------------------------------


async def _phase1_event_iter(
    *,
    graph: Any,
    config: RunnableConfig,
    input_state: dict[str, Any] | None,
    brief_id: str,
    user_id: str,
    set_status: Any,
    store_clarification: Any,
) -> AsyncIterator[WorkflowEvent]:
    """Stream phase-1 events from the LangGraph.

    Tails `astream(stream_mode="updates")`, emitting a NodeStarted +
    NodeCompleted pair per phase-1 node. Stops when the graph pauses for
    clarification, when the plan is ready, or on error.
    """
    yield RunStarted(brief_id=brief_id)
    started = time.perf_counter()
    clarification_emitted = False

    async def _emit_clarification(questions: list[dict]) -> None:
        await store_clarification(brief_id=brief_id, user_id=user_id, questions=questions)
        await set_status(brief_id=brief_id, user_id=user_id, status="awaiting_clarification")

    try:
        async for stream_data in graph.astream(input_state, config, stream_mode="updates"):
            if not isinstance(stream_data, dict):
                continue
            for node_key, node_update in stream_data.items():
                if node_key not in _PHASE1_NODES:
                    continue
                node_name: NodeName = node_key  # type: ignore[assignment]
                yield NodeStarted(brief_id=brief_id, node=node_name)
                elapsed_ms = int((time.perf_counter() - started) * 1000)
                yield NodeCompleted(
                    brief_id=brief_id,
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
                        questions = list(marker.get("questions", []) or [])
                        yield ClarificationRequested(brief_id=brief_id, questions=questions)
                        await _emit_clarification(questions)
                        return
    except Exception as exc:  # noqa: BLE001
        log.exception("phase1_failed", brief_id=brief_id)
        await set_status(brief_id=brief_id, user_id=user_id, status="failed")
        yield RunFailed(brief_id=brief_id, message=str(exc))
        return

    # Stream ended — figure out where we landed.
    try:
        snapshot = await graph.aget_state(config)
    except Exception as exc:  # noqa: BLE001
        log.exception("phase1_aget_state_failed", brief_id=brief_id)
        await set_status(brief_id=brief_id, user_id=user_id, status="failed")
        yield RunFailed(brief_id=brief_id, message=str(exc))
        return

    values: dict[str, Any] = (snapshot.values if snapshot else {}) or {}

    plan = values.get("research_plan")
    if plan:
        await set_status(
            brief_id=brief_id, user_id=user_id, status="awaiting_plan_approval"
        )
        yield PlanReady(brief_id=brief_id, plan=plan)
        return

    marker = _extract_clarify_marker(values.get("messages") or [])
    if marker and marker.get("type") == "clarification" and not clarification_emitted:
        questions = list(marker.get("questions", []) or [])
        yield ClarificationRequested(brief_id=brief_id, questions=questions)
        await _emit_clarification(questions)
        return

    await set_status(brief_id=brief_id, user_id=user_id, status="failed")
    yield RunFailed(brief_id=brief_id, message="Phase 1 ended in an unexpected state")


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
