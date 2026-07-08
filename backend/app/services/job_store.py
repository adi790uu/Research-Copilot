from __future__ import annotations

import json
import uuid

from sqlalchemy import select

from app.persistence.db import get_sessionmaker
from app.persistence.models import ResearchJobORM, ResearchTaskORM


async def create_job(brief_id: str, user_id: str, research_plan: str) -> str:
    job_id = str(uuid.uuid4())
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        row = ResearchJobORM(
            id=job_id,
            brief_id=brief_id,
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


async def get_job(job_id: str) -> dict | None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        row = await db.get(ResearchJobORM, job_id)
        if row is None:
            return None
        return _serialize_job(row)


async def get_job_by_brief(brief_id: str) -> dict | None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        result = await db.execute(
            select(ResearchJobORM)
            .where(ResearchJobORM.brief_id == brief_id)
            .order_by(ResearchJobORM.created_at.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        return _serialize_job(row)


def _parse_artifact(raw: str | dict | None) -> dict | None:
    """Artifacts are stored as JSON strings by the worker; return a dict."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _serialize_job(row: ResearchJobORM) -> dict:
    return {
        "id": row.id,
        "brief_id": row.brief_id,
        "user_id": row.user_id,
        "status": row.status,
        "research_plan": row.research_plan,
        "company_report": _parse_artifact(row.company_report),
        "person_report": _parse_artifact(row.person_report),
        "pitch": _parse_artifact(row.pitch),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


async def get_progress_by_brief(brief_id: str) -> dict:
    """Latest job's status + its tasks for a brief, for the running-card poll.

    Returns ``{"status": <job status or "pending">, "tasks": [{title, status}]}``.
    A brief with no job yet reports ``pending`` with no tasks.
    """
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        result = await db.execute(
            select(ResearchJobORM)
            .where(ResearchJobORM.brief_id == brief_id)
            .order_by(ResearchJobORM.created_at.desc())
            .limit(1)
        )
        job = result.scalar_one_or_none()
        if job is None:
            return {"status": "pending", "tasks": []}

        task_rows = await db.execute(
            select(ResearchTaskORM)
            .where(ResearchTaskORM.job_id == job.id)
            .order_by(ResearchTaskORM.created_at)
        )
        tasks = [
            {"title": t.title, "status": t.status} for t in task_rows.scalars().all()
        ]
        return {"status": job.status, "tasks": tasks}
