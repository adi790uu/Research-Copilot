"""Workflow + research-job HTTP endpoints.

Two surfaces:

* **Phase 1 chat** (`POST /sessions/{id}/chat`) — drives clarify → brief →
  plan inline, streaming events as SSE until the graph pauses for
  clarification or plan approval.
* **Phase 2 jobs** — `POST /sessions/{id}/plan/approve` kicks off a
  background `ResearchJob`; the frontend polls `GET /jobs/{id}` until the
  job is `completed` or `failed`.
"""

from __future__ import annotations

import json as _json
import re
import unicodedata
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.core.errors import AppError, NotFoundError
from app.core.logging import get_logger
from app.domain.events import WorkflowEvent
from app.domain.report import Report, ReportContent
from app.persistence.db import get_db_session
from app.persistence.repositories import SessionRepository
from app.services import job_store, report_chat
from app.services.pdf_export import PDFRenderError, report_to_pdf
from app.services.workflow_service import WorkflowService
class PDFUnavailableError(AppError):
    status_code = 503
    code = "pdf_renderer_unavailable"


log = get_logger(__name__)


def _service(request: Request) -> WorkflowService:
    return request.app.state.workflow_service  # type: ignore[no-any-return]


# ─── Phase 1: chat SSE ──────────────────────────────────────────────────────

router = APIRouter(prefix="/sessions/{session_id}", tags=["workflow"])


ChatTurnKind = Literal["start", "answer", "subscribe"]


class ChatTurn(BaseModel):
    """One user turn in the phase-1 chat flow."""

    kind: ChatTurnKind
    # For "answer": the message text to inject (typically the clarification
    # answer the user picked).
    message: str | None = None


@router.post("/chat")
async def chat(
    session_id: str,
    payload: ChatTurn,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    """SSE stream for the phase-1 portion of the workflow.

    The body's `kind` advances the graph:
      - `start`: seed the run (no message).
      - `answer`: append `message` as a new HumanMessage and re-drive.
      - `subscribe`: tail the current run without injecting a turn.

    The stream closes when the graph pauses (clarification_requested /
    plan_ready) or fails. The frontend then either submits answers (POST
    /chat with `answer`) or approves the plan (POST /plan/approve).
    """
    owned = await SessionRepository(db, user.id).get(session_id)
    if owned is None:
        raise NotFoundError(f"Session {session_id} not found")

    svc = _service(request)
    message = payload.message if payload.kind == "answer" else None
    if payload.kind == "answer" and not (payload.message and payload.message.strip()):
        raise AppError("'answer' requires a non-empty message")

    event_iter = await svc.run_phase1(
        session_id=session_id, user_id=user.id, message=message
    )

    async def generator() -> AsyncIterator[bytes]:
        async for ev in event_iter:
            if await request.is_disconnected():
                return
            yield _sse_format(ev)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _sse_format(event: WorkflowEvent) -> bytes:
    payload = event.model_dump_json()
    return f"event: {event.type}\ndata: {payload}\n\n".encode()


# ─── Plan approval → trigger phase-2 worker ─────────────────────────────────


class PlanApproval(BaseModel):
    """Approve (and optionally edit) the plan, then launch phase 2."""

    # When provided, the edited plan is saved to the checkpoint before launch.
    plan: dict | None = None


@router.post("/plan/approve")
async def approve_plan(
    session_id: str,
    payload: PlanApproval,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Create the research job and trigger the external worker.

    Returns `{"job_id": ...}`; the frontend then polls `GET /jobs/{id}`.
    """
    owned = await SessionRepository(db, user.id).get(session_id)
    if owned is None:
        raise NotFoundError(f"Session {session_id} not found")

    svc = _service(request)
    if payload.plan is not None:
        await svc.save_plan_edits(session_id=session_id, user_id=user.id, plan=payload.plan)
    job_id = await svc.approve_plan(session_id=session_id, user_id=user.id)
    return {"job_id": job_id}


# ─── Session-scoped reads ───────────────────────────────────────────────────


@router.get("/jobs")
async def list_session_jobs(
    session_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    owned = await SessionRepository(db, user.id).get(session_id)
    if owned is None:
        raise NotFoundError(f"Session {session_id} not found")
    job = await job_store.get_job_by_session(session_id)
    return [job] if job else []


@router.get("/job")
async def get_latest_job(
    session_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Convenience: the most recent job for this session, or 404 if none."""
    owned = await SessionRepository(db, user.id).get(session_id)
    if owned is None:
        raise NotFoundError(f"Session {session_id} not found")
    job = await job_store.get_job_by_session(session_id)
    if job is None:
        raise NotFoundError(f"No job for session {session_id}")
    return job


# ─── Follow-up chat over a finished report ─────────────────────────────────


class FollowupMessage(BaseModel):
    """User turn for the post-report chat."""

    content: str = Field(min_length=1, max_length=4000)


@router.get("/messages")
async def list_session_messages(
    session_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    return await report_chat.list_messages(
        db, session_id=session_id, user_id=user.id
    )


@router.post("/messages")
async def post_session_message(
    session_id: str,
    payload: FollowupMessage,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:
    """Stream a follow-up reply token-by-token.

    SSE frames: `event: token\\ndata: <text>\\n\\n` per chunk,
    `event: done\\ndata: {}\\n\\n` when the reply is complete.
    """

    async def generator() -> AsyncIterator[bytes]:
        try:
            async for chunk in report_chat.stream_followup(
                db,
                session_id=session_id,
                user_id=user.id,
                question=payload.content,
            ):
                if await request.is_disconnected():
                    return
                yield f"event: token\ndata: {_sse_escape(chunk)}\n\n".encode()
            yield b"event: done\ndata: {}\n\n"
        except Exception as exc:  # noqa: BLE001
            # Surface the error inline so the frontend can render it.
            msg = str(exc).replace("\n", " ")
            yield f"event: error\ndata: {msg}\n\n".encode()

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _sse_escape(text: str) -> str:
    # SSE `data:` lines can't contain raw newlines — split into multiple
    # `data:` continuation lines per the spec.
    return text.replace("\r\n", "\n").replace("\n", "\ndata: ")


# ─── Job-scoped reads ───────────────────────────────────────────────────────

jobs_router = APIRouter(prefix="/jobs", tags=["jobs"])


async def _job_or_404(job_id: str, user_id: str) -> dict:
    job = await job_store.get_job(job_id)
    if job is None:
        raise NotFoundError(f"Job {job_id} not found")
    if job.get("user_id") != user_id:
        # Treat ownership mismatch as 404 — don't leak existence.
        raise NotFoundError(f"Job {job_id} not found")
    return job


@jobs_router.get("/{job_id}")
async def get_job(
    job_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return await _job_or_404(job_id, user.id)


@jobs_router.get("/{job_id}/events")
async def get_job_events(
    job_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    await _job_or_404(job_id, user.id)
    return await job_store.get_job_events(job_id)


@jobs_router.get("/{job_id}/researchers")
async def get_job_researchers(
    job_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    await _job_or_404(job_id, user.id)
    return await job_store.get_job_researchers(job_id)


@jobs_router.get("/{job_id}/tasks")
async def get_job_tasks(
    job_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    await _job_or_404(job_id, user.id)
    return await job_store.get_job_tasks(job_id)


@jobs_router.get("/{job_id}/report.pdf")
async def get_job_report_pdf(
    job_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> Response:
    job = await _job_or_404(job_id, user.id)
    raw_report = job.get("final_report")
    if not raw_report:
        raise NotFoundError(f"Job {job_id} has no final report yet")

    # research_jobs.final_report is the JSON-encoded ReportContent that
    # background.py wrote. Parse it back into a typed Report so pdf_export
    # can render the structured 8-section template.
    try:
        content_dict = (
            raw_report if isinstance(raw_report, dict) else _json.loads(raw_report)
        )
        content = ReportContent.model_validate(content_dict)
    except (ValueError, _json.JSONDecodeError) as exc:
        log.error("report_payload_corrupt", job_id=job_id, error=str(exc))
        raise NotFoundError(f"Job {job_id} report payload is corrupt") from exc

    session_id = job.get("session_id", "")
    sess = await SessionRepository(db, user.id).get(session_id)
    company_name = sess.company_name if sess else "Company"
    objective = sess.objective if sess else ""

    created_at_iso = job.get("updated_at") or job.get("created_at")
    created_at = (
        datetime.fromisoformat(created_at_iso)
        if isinstance(created_at_iso, str)
        else datetime.now(UTC)
    )

    report = Report(
        id=job_id,
        session_id=session_id,
        content=content,
        created_at=created_at,
    )

    try:
        pdf_bytes = report_to_pdf(
            report,
            company_name=company_name,
            objective=objective,
        )
    except PDFRenderError as exc:
        log.error("pdf_renderer_unavailable", error=str(exc))
        raise PDFUnavailableError(str(exc)) from exc

    filename = f"brief-{_slugify(company_name)}-{job_id[:6]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )


def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower() or "brief"
