from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, NotFoundError
from app.persistence.repositories import (
    BriefRepository,
    MessageRepository,
)
from app.services import job_store
from app.workflow.helpers import _create_model, _get_today_str

logger = logging.getLogger(__name__)


_MAX_SECTION_CHARS = 3000
_MAX_SOURCES_IN_PROMPT = 80
_HISTORY_TURN_CAP = 12


class ReportNotReadyError(AppError):
    status_code = 409
    code = "report_not_ready"


def _format_sources(sources: list[dict]) -> str:
    if not sources:
        return "(no sources)"
    out: list[str] = []
    for s in sources[:_MAX_SOURCES_IN_PROMPT]:
        sid = s.get("id") or "?"
        title = s.get("title") or s.get("url") or "?"
        url = s.get("url") or ""
        out.append(f"[{sid}] {title} — {url}")
    if len(sources) > _MAX_SOURCES_IN_PROMPT:
        out.append(f"… +{len(sources) - _MAX_SOURCES_IN_PROMPT} more sources")
    return "\n".join(out)


def _format_report(report_json: str) -> str:
    try:
        data = json.loads(report_json)
    except (ValueError, TypeError):
        return report_json[: _MAX_SECTION_CHARS * 8]

    parts: list[str] = []
    summary = (data.get("summary") or "").strip()
    if summary:
        parts.append(f"## Summary\n{summary}")

    for sec in data.get("sections") or []:
        label = (sec.get("heading") or "Section").strip()
        content = (sec.get("content") or "").strip()
        if not content:
            continue
        if len(content) > _MAX_SECTION_CHARS:
            content = content[:_MAX_SECTION_CHARS] + " […truncated]"
        cites = sec.get("source_ids") or []
        cite_strip = f"  (cites: {', '.join(cites)})" if cites else ""
        parts.append(f"## {label}{cite_strip}\n{content}")
    return "\n\n".join(parts)


def _build_system_prompt(
    *, company_name: str, website: str, report_md: str, sources_block: str
) -> str:
    return f"""You are a sales analyst answering follow-up questions about {company_name} ({website}).

You have already produced a research brief on this company. Treat that brief
as your ONLY source of truth — do not invent facts beyond what is grounded
in the sections or sources below. If the brief doesn't cover something the
user asks about, say so explicitly rather than guessing.

Cite source IDs inline with `[src_xxxxxxxx]` when you reference a specific
fact from the brief. Only cite IDs that appear in the sources list.

Today's date: {_get_today_str()}.

## Brief

{report_md}

## Sources

{sources_block}
"""


def _to_history_messages(rows: list[dict]) -> list[Any]:
    trimmed = rows[-_HISTORY_TURN_CAP:]
    msgs: list[Any] = []
    for row in trimmed:
        role = row.get("role")
        content = row.get("content") or ""
        if role == "user":
            msgs.append(HumanMessage(content=content))
        elif role == "assistant":
            msgs.append(AIMessage(content=content))
    return msgs


async def list_messages(
    db: AsyncSession, *, brief_id: str, user_id: str, kind: str | None = None
) -> list[dict]:
    brief = await BriefRepository(db, user_id).get(brief_id)
    if brief is None:
        raise NotFoundError(f"Brief {brief_id} not found")
    rows = await MessageRepository(db, brief_id).list(kind=kind)
    return [
        {
            "id": r.id,
            "role": r.role,
            "content": r.content,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


async def stream_followup(
    db: AsyncSession,
    *,
    brief_id: str,
    user_id: str,
    question: str,
) -> AsyncIterator[str]:
    brief = await BriefRepository(db, user_id).get(brief_id)
    if brief is None:
        raise NotFoundError(f"Brief {brief_id} not found")

    job = await job_store.get_job_by_brief(brief_id)
    if not job or not job.get("final_report"):
        raise ReportNotReadyError("Follow-up chat is only available after research completes.")

    msg_repo = MessageRepository(db, brief_id)
    history_rows = await msg_repo.list(kind="followup")
    history = [
        {
            "role": r.role,
            "content": r.content,
        }
        for r in history_rows
    ]

    await msg_repo.add(role="user", content=question.strip(), kind="followup")
    await db.commit()

    system = _build_system_prompt(
        company_name=brief.company_name,
        website=brief.website,
        report_md=_format_report(str(job.get("final_report") or "")),
        sources_block=_format_sources(job.get("sources") or []),
    )

    model = _create_model(temperature=0.3)
    messages: list[Any] = [SystemMessage(content=system)]
    messages.extend(_to_history_messages(history))
    messages.append(HumanMessage(content=question.strip()))

    assistant_buffer: list[str] = []
    try:
        async for chunk in model.astream(messages):
            piece = _extract_text(chunk)
            if not piece:
                continue
            assistant_buffer.append(piece)
            yield piece
    except Exception as exc:  # noqa: BLE001
        logger.exception("followup stream failed for brief %s", brief_id)
        assistant_buffer.append(f"\n\n[stream failed: {exc}]")
        yield f"\n\n[stream failed: {exc}]"

    final = "".join(assistant_buffer).strip()
    if final:
        await msg_repo.add(role="assistant", content=final, kind="followup")
        await db.commit()


def _extract_text(chunk: Any) -> str:
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out: list[str] = []
        for part in content:
            if isinstance(part, str):
                out.append(part)
            elif isinstance(part, dict):
                txt = part.get("text")
                if isinstance(txt, str):
                    out.append(txt)
        return "".join(out)
    return ""
