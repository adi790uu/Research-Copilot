"""Persistence for research jobs and their progress artefacts.

Each function opens its own AsyncSession because callers are mixed-mode:
the foreground SSE path runs inside a request, the background graph stream
runs in a detached asyncio.Task with no request scope. Keeping the store
self-contained lets both call sites use it identically.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from sqlalchemy import select

from app.persistence.db import get_sessionmaker
from app.persistence.models import (
    ResearchJobEventORM,
    ResearchJobORM,
    ResearchJobResearcherORM,
    ResearchTaskORM,
)

logger = logging.getLogger(__name__)


def _jsonable(obj: Any) -> Any:
    """Best-effort conversion for sources/event payloads."""
    try:
        from pydantic import BaseModel

        if isinstance(obj, BaseModel):
            return obj.model_dump(mode="json")
    except ImportError:
        pass
    if isinstance(obj, list):
        return [_jsonable(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    obj_dict = getattr(obj, "__dict__", None)
    if isinstance(obj_dict, dict):
        return {k: _jsonable(v) for k, v in obj_dict.items() if not k.startswith("_")}
    return str(obj)


# ---- jobs ------------------------------------------------------------------


async def create_job(session_id: str, user_id: str, research_plan: str) -> str:
    job_id = str(uuid.uuid4())
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        row = ResearchJobORM(
            id=job_id,
            session_id=session_id,
            user_id=user_id,
            status="pending",
            research_plan=research_plan,
        )
        db.add(row)
        await db.commit()
    return job_id


async def update_job_status(job_id: str, status: str) -> None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        row = await db.get(ResearchJobORM, job_id)
        if row is None:
            return
        row.status = status
        await db.commit()


async def update_job_result(
    job_id: str, final_report: str, sources: list[Any] | None = None
) -> None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        row = await db.get(ResearchJobORM, job_id)
        if row is None:
            return
        row.status = "completed"
        row.final_report = final_report
        row.sources = _jsonable(sources or [])
        await db.commit()


async def update_job_report_pdf_key(job_id: str, report_pdf_key: str) -> None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        row = await db.get(ResearchJobORM, job_id)
        if row is None:
            return
        row.report_pdf_key = report_pdf_key
        await db.commit()


async def append_job_event(
    job_id: str, event_type: str, data: dict[str, Any]
) -> None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        db.add(
            ResearchJobEventORM(
                job_id=job_id, event_type=event_type, data=_jsonable(data)
            )
        )
        await db.commit()


async def get_job(job_id: str) -> dict | None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        row = await db.get(ResearchJobORM, job_id)
        if row is None:
            return None
        return _serialize_job(row)


async def get_job_by_session(session_id: str) -> dict | None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        result = await db.execute(
            select(ResearchJobORM)
            .where(ResearchJobORM.session_id == session_id)
            .order_by(ResearchJobORM.created_at.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        return _serialize_job(row)


def _serialize_job(row: ResearchJobORM) -> dict:
    sources = row.sources
    if isinstance(sources, str):
        try:
            sources = json.loads(sources)
        except json.JSONDecodeError:
            sources = []
    return {
        "id": row.id,
        "session_id": row.session_id,
        "user_id": row.user_id,
        "status": row.status,
        "research_plan": row.research_plan,
        "final_report": row.final_report,
        "sources": sources or [],
        "report_pdf_key": row.report_pdf_key,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ---- researchers -----------------------------------------------------------


async def append_researcher_result(
    job_id: str, topic: str, summary: str, sources: list[Any] | None = None
) -> None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        db.add(
            ResearchJobResearcherORM(
                job_id=job_id,
                topic=topic,
                summary=summary,
                sources=_jsonable(sources or []),
            )
        )
        await db.commit()


async def get_job_researchers(job_id: str) -> list[dict]:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        result = await db.execute(
            select(ResearchJobResearcherORM)
            .where(ResearchJobResearcherORM.job_id == job_id)
            .order_by(ResearchJobResearcherORM.id)
        )
        rows = result.scalars().all()
        return [
            {
                "topic": r.topic,
                "summary": r.summary or "",
                "sources": r.sources or [],
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]


# ---- events ----------------------------------------------------------------


async def get_job_events(job_id: str) -> list[dict]:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        result = await db.execute(
            select(ResearchJobEventORM)
            .where(ResearchJobEventORM.job_id == job_id)
            .order_by(ResearchJobEventORM.id)
        )
        rows = result.scalars().all()
        return [
            {
                "event_type": r.event_type,
                "data": r.data,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]


# ---- tasks -----------------------------------------------------------------


async def create_task(job_id: str, research_topic: str) -> str:
    task_id = str(uuid.uuid4())
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        title = research_topic[:200] if research_topic else "(untitled)"
        db.add(
            ResearchTaskORM(
                id=task_id,
                job_id=job_id,
                title=title,
                description=research_topic or "",
                status="running",
            )
        )
        await db.commit()
    return task_id


async def complete_task(task_id: str) -> None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        row = await db.get(ResearchTaskORM, task_id)
        if row is None:
            return
        row.status = "completed"
        await db.commit()


async def fail_task(task_id: str) -> None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        row = await db.get(ResearchTaskORM, task_id)
        if row is None:
            return
        row.status = "failed"
        await db.commit()


async def fail_running_tasks(job_id: str) -> None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        result = await db.execute(
            select(ResearchTaskORM).where(
                ResearchTaskORM.job_id == job_id, ResearchTaskORM.status == "running"
            )
        )
        for row in result.scalars().all():
            row.status = "failed"
        await db.commit()


async def get_job_tasks(job_id: str) -> list[dict]:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        result = await db.execute(
            select(ResearchTaskORM)
            .where(ResearchTaskORM.job_id == job_id)
            .order_by(ResearchTaskORM.created_at)
        )
        rows = result.scalars().all()
        return [
            {
                "id": r.id,
                "title": r.title,
                "description": r.description,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]
