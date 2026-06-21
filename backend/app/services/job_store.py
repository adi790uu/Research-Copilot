"""Read access to research jobs and their progress artefacts.

The phase-2 worker (TypeScript Trigger.dev task) writes job results,
researcher rows, events and tasks straight to the shared Postgres. The
Python backend only *creates* the pending job (on plan approval) and
*reads* progress back for the API, so this module is read-mostly.
"""

from __future__ import annotations

import json
import uuid

from sqlalchemy import select

from app.persistence.db import get_sessionmaker
from app.persistence.models import (
    ResearchJobEventORM,
    ResearchJobORM,
    ResearchJobResearcherORM,
    ResearchTaskORM,
)


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
