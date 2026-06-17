"""Orchestrates a company-research run.

Two phases:

1. **Phase 1 (foreground)** — clarify → brief → plan. Drives the graph
   inline so the caller can stream events out as SSE. Closes when the
   graph pauses (clarification needed, or `interrupt_after=create_research_plan`)
   or terminates.

2. **Phase 2 (background)** — supervisor + final_report. Kicked off by
   `approve_plan`, which creates a `ResearchJob` row and spawns an
   asyncio task that resumes the checkpoint and persists progress to the
   DB via `job_store`. The frontend polls `/jobs/{id}` until the job is
   completed or failed.
"""

from __future__ import annotations

import asyncio
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
from app.providers.factory import build_providers
from app.services import background, job_store
from app.workflow.deps import WorkflowDeps
from app.workflow.graph import build_graph

log = get_logger(__name__)


class RunAlreadyInFlightError(AppError):
    status_code = 409
    code = "run_already_in_flight"


_PHASE1_NODES = {
    "clarify_with_user",
    "write_research_brief",
    "create_research_plan",
}


class WorkflowService:
    """One instance per process; bound to app.state."""

    def __init__(self, *, checkpointer: BaseCheckpointSaver) -> None:
        self._checkpointer = checkpointer
        # Tracks background jobs per session so the same session can't kick
        # off two phase-2 runs concurrently.
        self._bg_tasks: dict[str, asyncio.Task[None]] = {}

    # ----- builders ---------------------------------------------------------

    def _build(
        self, *, session_id: str, company_name: str, website: str
    ) -> tuple[Any, RunnableConfig]:
        """Build the LangGraph + RunnableConfig for a session in lockstep.

        The search provider lives in two places at once: on `WorkflowDeps`
        (so the graph's `_bind` wrapper can reach it for emit/etc.) and
        inside `config.configurable.search_provider` (so the researcher's
        Tavily-backed tools can pull it out at tool-call time via
        `LangChain`'s injected `RunnableConfig`). Both references point at
        the same provider instance — that's why we build them together
        here instead of two separate methods.
        """
        settings = get_settings()
        llm, search = build_providers(settings, company_hint=company_name)
        deps = WorkflowDeps(llm=llm, search=search)
        graph = build_graph(deps, checkpointer=self._checkpointer)
        config: RunnableConfig = {
            "configurable": {
                "thread_id": session_id,
                # Tools read this off configurable. Forgetting it = every
                # researcher errors with "company_site_search is not
                # configured (missing search provider …)".
                "search_provider": search,
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
                    "supervisor_messages": {"type": "override", "value": []},
                    "notes": {"type": "override", "value": []},
                    "raw_notes": {"type": "override", "value": []},
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
            auto_spawn_job=self._auto_spawn_job,
        )

    # ----- phase 2 (background) ---------------------------------------------

    async def _auto_spawn_job(
        self,
        *,
        session_id: str,
        user_id: str,
        graph: Any,
        config: RunnableConfig,
    ) -> str:
        """Create a research_jobs row and spawn the background task.

        Single source of truth for phase-2 kickoff. Called by `_phase1_event_iter`
        at the `interrupt_after` boundary and by `approve_plan` (legacy, unused
        from the API today).

        Raises if a job is already in flight for this session, if the DB
        insert fails, or if scheduling the task fails. Callers wrap the
        failure path so the user sees a clear error.
        """
        existing = self._bg_tasks.get(session_id)
        if existing is not None and not existing.done():
            raise RunAlreadyInFlightError(
                f"Session {session_id} already has a background job in flight"
            )

        # Read the plan off the checkpoint so we can persist it on the job row.
        snapshot = await graph.aget_state(config)
        values: dict[str, Any] = (snapshot.values if snapshot else {}) or {}
        plan = values.get("research_plan") or {}
        plan_text = json.dumps(plan)

        job_id = await job_store.create_job(
            session_id=session_id, user_id=user_id, research_plan=plan_text
        )

        # Thread the job_id through the supervisor's RunnableConfig so it
        # can write `research_tasks` rows + per-researcher results directly
        # (matches research-assistant's pattern, supervisor.py:98). Build a
        # fresh dict so we don't mutate the caller's config object.
        bg_config: RunnableConfig = {
            **config,
            "configurable": {
                **(config.get("configurable") or {}),
                "job_id": job_id,
            },
        }

        task = asyncio.create_task(
            background.run_background_job(job_id, graph, bg_config),
            name=f"job-{job_id}",
        )
        self._bg_tasks[session_id] = task

        def _on_done(t: asyncio.Task[None]) -> None:
            self._bg_tasks.pop(session_id, None)
            # Reflect the job's terminal state on the session.
            asyncio.create_task(
                self._sync_session_from_job(
                    session_id=session_id, user_id=user_id, job_id=job_id
                )
            )

        task.add_done_callback(_on_done)
        return job_id

    async def approve_plan(self, *, session_id: str, user_id: str) -> str:
        """Spawn a background ResearchJob that runs supervisor + final_report.

        Returns the `job_id`. Kept for API compatibility but no longer wired
        into any route — phase 2 now auto-spawns from the SSE handler. Will
        be removed once we're sure manual approval isn't coming back.
        """
        company_name, website, _ = await self._load_session(
            session_id=session_id, user_id=user_id
        )
        graph, config = self._build(
            session_id=session_id, company_name=company_name, website=website
        )
        job_id = await self._auto_spawn_job(
            session_id=session_id, user_id=user_id, graph=graph, config=config
        )
        await self._set_status(session_id=session_id, user_id=user_id, status="running")
        return job_id

    async def _sync_session_from_job(
        self, *, session_id: str, user_id: str, job_id: str
    ) -> None:
        job = await job_store.get_job(job_id)
        if not job:
            return
        status_map = {"completed": "completed", "failed": "failed"}
        new_status = status_map.get(job.get("status", ""), "running")
        await self._set_status(
            session_id=session_id, user_id=user_id, status=new_status
        )

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
    auto_spawn_job: Any,
) -> AsyncIterator[WorkflowEvent]:
    """Stream phase-1 events from the LangGraph.

    Tails `astream(stream_mode="updates")` and emits a `NodeStarted` +
    `NodeCompleted` pair per phase-1 node update. The stream stops when:
      - The graph reaches `interrupt_after=[create_research_plan]`. The
        generator immediately auto-spawns the phase-2 background job (via
        the `auto_spawn_job` callable injected by the service), then yields
        `PlanReady{plan, job_id}` and closes. If auto-spawn fails (DB
        write, task scheduling), `RunFailed` is yielded instead and the
        session is marked failed.
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

    next_nodes = snapshot.next if snapshot else ()
    values: dict[str, Any] = (snapshot.values if snapshot else {}) or {}

    if next_nodes and "research_supervisor" in next_nodes:
        plan = values.get("research_plan") or {}
        # Auto-spawn the phase-2 background job. If anything goes wrong here
        # (DB insert, task scheduling), tell the user the research failed
        # instead of yielding PlanReady to a job that doesn't exist.
        try:
            job_id = await auto_spawn_job(
                session_id=session_id,
                user_id=user_id,
                graph=graph,
                config=config,
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("phase1_auto_spawn_failed", session_id=session_id)
            await set_status(session_id=session_id, user_id=user_id, status="failed")
            yield RunFailed(
                session_id=session_id,
                message=f"Could not start research: {exc}",
            )
            return
        await set_status(session_id=session_id, user_id=user_id, status="running")
        yield PlanReady(session_id=session_id, plan=plan, job_id=job_id)
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
