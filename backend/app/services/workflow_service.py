from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver

from app.core.config import get_settings
from app.core.errors import AppError
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
    def __init__(self, *, checkpointer: BaseCheckpointSaver) -> None:
        self._checkpointer = checkpointer

    def _build(
        self, *, brief_id: str, allow_clarification: bool | None = None
    ) -> tuple[Any, RunnableConfig]:
        settings = get_settings()
        config: RunnableConfig = {
            "configurable": {
                "thread_id": brief_id,
                "allow_clarification": (
                    settings.workflow_allow_clarification
                    if allow_clarification is None
                    else allow_clarification
                ),
            }
        }
        graph = build_graph(checkpointer=self._checkpointer)
        return graph, config

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
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            await MessageRepository(db, brief_id).add(role="user", content=content, kind="workflow")
            if clarification_answered:
                await BriefRepository(db, user_id).mark_clarification_answered(
                    brief_id, clarification_answers
                )
            await db.commit()

    async def _store_clarification(
        self, *, brief_id: str, user_id: str, questions: list[dict]
    ) -> None:
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            await BriefRepository(db, user_id).set_clarification_question(brief_id, questions)
            await db.commit()

    async def run_phase1(
        self,
        *,
        brief_id: str,
        user_id: str,
        message: str | None = None,
        clarification_answered: bool = False,
        clarification_answers: list[dict] | None = None,
        is_start: bool = False,
        contact_name: str | None = None,
        contact_email: str | None = None,
        contact_resolution: dict | None = None,
        allow_clarification: bool | None = None,
    ) -> AsyncIterator[WorkflowEvent]:
        graph, config = self._build(brief_id=brief_id, allow_clarification=allow_clarification)
        await self._set_status(brief_id=brief_id, user_id=user_id, status="running")

        input_state: dict[str, Any] | None = None
        if message and message.strip():
            text = message.strip()
            if is_start:
                contact_line = _contact_context_line(
                    contact_name=contact_name,
                    contact_email=contact_email,
                    contact_resolution=contact_resolution,
                )
                if contact_line:
                    text = f"{text}\n\n{contact_line}"
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

    async def approve_plan(self, *, brief_id: str, user_id: str) -> str:
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
        await set_status(brief_id=brief_id, user_id=user_id, status="awaiting_plan_approval")
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


def _contact_context_line(
    *,
    contact_name: str | None,
    contact_email: str | None,
    contact_resolution: dict | None,
) -> str | None:
    if not contact_name:
        return None
    res = contact_resolution or {}
    if res.get("status") == "resolved":
        role = (
            f"{res['title']} at {res['company']}"
            if res.get("title") and res.get("company")
            else res.get("company") or res.get("title") or "an unspecified role"
        )
        linkedin = f" LinkedIn: {res['linkedin_url']}." if res.get("linkedin_url") else ""
        return (
            f"Meeting contact: {contact_name}, resolved as {role} "
            f"(match confidence {res.get('likelihood', '?')}/10).{linkedin} Treat this identity as "
            "verified — the plan must include a dedicated coverage angle researching this person's "
            "background, role, and likely priorities for this meeting."
        )
    email_part = f" ({contact_email})" if contact_email else ""
    return (
        f"Meeting contact: {contact_name}{email_part} — could not be confidently verified against "
        "public data. The plan should include a coverage angle that attempts identification via "
        "the target company's own team/about page or public web presence, anchored strictly to "
        "the company; the final report must state explicitly if the person cannot be confirmed "
        "rather than guessing or attributing facts about a differently-named individual."
    )


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
