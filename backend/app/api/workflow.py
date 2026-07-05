from __future__ import annotations

import json as _json
import re
import unicodedata
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.core.errors import AppError, NotFoundError
from app.core.logging import get_logger
from app.domain.events import WorkflowEvent
from app.domain.report import Report, ReportContent
from app.persistence.db import get_db_session
from app.persistence.repositories import BriefRepository
from app.services import job_store, report_chat
from app.services.pdf_export import PDFRenderError, report_to_pdf
from app.services.workflow_service import WorkflowService


class PDFUnavailableError(AppError):
    status_code = 503
    code = "pdf_renderer_unavailable"


log = get_logger(__name__)


def _service(request: Request) -> WorkflowService:
    return request.app.state.workflow_service  # type: ignore[no-any-return]


router = APIRouter(prefix="/briefs/{brief_id}", tags=["workflow"])


ChatTurnKind = Literal["start", "answer", "subscribe"]


class ClarificationAnswer(BaseModel):
    question: str
    answer: str


class ChatTurn(BaseModel):
    kind: ChatTurnKind
    message: str | None = None
    clarification_question_answered: bool = False
    clarification_answers: list[ClarificationAnswer] | None = None


@router.post("/chat")
async def chat(
    brief_id: str,
    payload: ChatTurn,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    owned = await BriefRepository(db, user.id).get(brief_id)
    if owned is None:
        raise NotFoundError(f"Brief {brief_id} not found")

    if payload.kind == "answer" and not (payload.message and payload.message.strip()):
        raise AppError("'answer' requires a non-empty message")

    svc = _service(request)
    message = None if payload.kind == "subscribe" else payload.message
    answers = (
        [a.model_dump() for a in payload.clarification_answers]
        if payload.clarification_answers
        else None
    )
    event_iter = await svc.run_phase1(
        brief_id=brief_id,
        user_id=user.id,
        message=message,
        clarification_answered=payload.clarification_question_answered,
        clarification_answers=answers,
        is_start=payload.kind == "start",
        contact_name=owned.contact_name,
        contact_email=owned.contact_email,
        contact_resolution=owned.contact_resolution,
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


@router.post("/plan/approve")
async def approve_plan(
    brief_id: str,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    owned = await BriefRepository(db, user.id).get(brief_id)
    if owned is None:
        raise NotFoundError(f"Brief {brief_id} not found")

    job_id = await _service(request).approve_plan(brief_id=brief_id, user_id=user.id)
    return {"job_id": job_id}


@router.get("/jobs")
async def list_brief_jobs(
    brief_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    owned = await BriefRepository(db, user.id).get(brief_id)
    if owned is None:
        raise NotFoundError(f"Brief {brief_id} not found")
    job = await job_store.get_job_by_brief(brief_id)
    return [job] if job else []


@router.get("/job")
async def get_latest_job(
    brief_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    owned = await BriefRepository(db, user.id).get(brief_id)
    if owned is None:
        raise NotFoundError(f"Brief {brief_id} not found")
    job = await job_store.get_job_by_brief(brief_id)
    if job is None:
        raise NotFoundError(f"No job for brief {brief_id}")
    return job


class FollowupMessage(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


@router.get("/messages")
async def list_brief_messages(
    brief_id: str,
    kind: Literal["workflow", "followup"] | None = Query(default=None),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    return await report_chat.list_messages(db, brief_id=brief_id, user_id=user.id, kind=kind)


@router.post("/messages")
async def post_brief_message(
    brief_id: str,
    payload: FollowupMessage,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:

    async def generator() -> AsyncIterator[bytes]:
        try:
            async for chunk in report_chat.stream_followup(
                db,
                brief_id=brief_id,
                user_id=user.id,
                question=payload.content,
            ):
                if await request.is_disconnected():
                    return
                yield f"event: token\ndata: {_sse_escape(chunk)}\n\n".encode()
            yield b"event: done\ndata: {}\n\n"
        except Exception as exc:  # noqa: BLE001
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
    return text.replace("\r\n", "\n").replace("\n", "\ndata: ")


jobs_router = APIRouter(prefix="/jobs", tags=["jobs"])


async def _job_or_404(job_id: str, user_id: str) -> dict:
    job = await job_store.get_job(job_id)
    if job is None:
        raise NotFoundError(f"Job {job_id} not found")
    if job.get("user_id") != user_id:
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

    try:
        content_dict = raw_report if isinstance(raw_report, dict) else _json.loads(raw_report)
        content = ReportContent.model_validate(content_dict)
    except (ValueError, _json.JSONDecodeError) as exc:
        log.error("report_payload_corrupt", job_id=job_id, error=str(exc))
        raise NotFoundError(f"Job {job_id} report payload is corrupt") from exc

    brief_id = job.get("brief_id", "")
    brief = await BriefRepository(db, user.id).get(brief_id)
    company_name = brief.company_name if brief else "Company"
    objective = brief.objective if brief else ""

    created_at_iso = job.get("updated_at") or job.get("created_at")
    created_at = (
        datetime.fromisoformat(created_at_iso)
        if isinstance(created_at_iso, str)
        else datetime.now(UTC)
    )

    report = Report(
        id=job_id,
        brief_id=brief_id,
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
