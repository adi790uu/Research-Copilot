"""Workflow run + SSE streaming endpoints."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

import re
import unicodedata

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.core.errors import AppError, NotFoundError
from app.core.logging import get_logger
from app.domain.events import WorkflowEvent
from app.domain.report import Report, ReportContent
from app.persistence.db import get_db_session
from app.persistence.repositories import ReportRepository, SessionRepository
from app.services.event_bus import WorkflowEventBus
from app.services.pdf_export import PDFRenderError, report_to_pdf
from app.services.workflow_service import WorkflowService


class PDFUnavailableError(AppError):
    status_code = 503
    code = "pdf_renderer_unavailable"

router = APIRouter(prefix="/sessions/{session_id}", tags=["workflow"])
log = get_logger(__name__)


def _bus(request: Request) -> WorkflowEventBus:
    return request.app.state.event_bus  # type: ignore[no-any-return]


def _service(request: Request) -> WorkflowService:
    return request.app.state.workflow_service  # type: ignore[no-any-return]


@router.post("/run", status_code=status.HTTP_202_ACCEPTED)
async def run_session(
    session_id: str,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    """Kick off a research run for the session. Returns immediately; the caller
    should connect to GET /stream to watch progress."""
    await _service(request).start_run(session_id=session_id, user_id=user.id)
    return {"session_id": session_id, "status": "running"}


def _sse_format(event: WorkflowEvent) -> bytes:
    """Encode a single SSE message: `event: <type>\\ndata: <json>\\n\\n`."""
    payload = event.model_dump_json()
    return f"event: {event.type}\ndata: {payload}\n\n".encode()


@router.get("/stream")
async def stream_session(
    session_id: str,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    """Server-Sent Events stream of run progress for a session.

    Replays the retained event log first (so reconnects see history), then
    tails new events until a terminal event (`report_ready` or `run_failed`)
    or the client disconnects.
    """
    # Ownership check — only the session's owner can subscribe.
    owned = await SessionRepository(db, user.id).get(session_id)
    if owned is None:
        raise NotFoundError(f"Session {session_id} not found")

    bus = _bus(request)
    replay, queue, already_terminated = await bus.subscribe(session_id)

    async def generator() -> AsyncIterator[bytes]:
        try:
            for ev in replay:
                yield _sse_format(ev)
            if already_terminated:
                return
            while True:
                if await request.is_disconnected():
                    return
                try:
                    ev = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    # SSE keep-alive comment — prevents proxies from closing idle conns.
                    yield b": keep-alive\n\n"
                    continue
                if ev is None:
                    return
                yield _sse_format(ev)
        finally:
            await bus.unsubscribe(session_id, queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/report", response_model=Report)
async def get_report(
    session_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> Report:
    owned = await SessionRepository(db, user.id).get(session_id)
    if owned is None:
        raise NotFoundError(f"Session {session_id} not found")

    row = await ReportRepository(db).get_by_session(session_id)
    if row is None:
        raise NotFoundError(f"Report for session {session_id} not found")

    content = row.content if isinstance(row.content, dict) else json.loads(row.content)
    return Report(
        id=row.id,
        session_id=row.session_id,
        content=ReportContent.model_validate(content),
        created_at=row.created_at,
    )


@router.get("/report.pdf")
async def get_report_pdf(
    session_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Render the report as a print-styled PDF and return it as a download."""
    owned = await SessionRepository(db, user.id).get(session_id)
    if owned is None:
        raise NotFoundError(f"Session {session_id} not found")

    row = await ReportRepository(db).get_by_session(session_id)
    if row is None:
        raise NotFoundError(f"Report for session {session_id} not found")

    content = row.content if isinstance(row.content, dict) else json.loads(row.content)
    report = Report(
        id=row.id,
        session_id=row.session_id,
        content=ReportContent.model_validate(content),
        created_at=row.created_at,
    )

    try:
        pdf_bytes = report_to_pdf(
            report,
            company_name=owned.company_name,
            objective=owned.objective,
        )
    except PDFRenderError as exc:
        log.error("pdf_renderer_unavailable", error=str(exc))
        raise PDFUnavailableError(str(exc)) from exc

    filename = f"brief-{_slugify(owned.company_name)}-{report.id[:6]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )


def _slugify(value: str) -> str:
    """Filesystem-safe ASCII slug. Conservative: alnum + hyphen."""
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower() or "brief"
