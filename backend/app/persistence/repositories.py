from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.persistence.models import (
    BriefORM,
    MessageORM,
    ResearchJobORM,
    UserORM,
)


class UserRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get(self, user_id: str) -> UserORM | None:
        result = await self._db.execute(select(UserORM).where(UserORM.id == user_id))
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> UserORM | None:
        result = await self._db.execute(
            select(UserORM).where(UserORM.email == email.lower())
        )
        return result.scalar_one_or_none()

    async def create(self, *, email: str, password_hash: str) -> UserORM:
        row = UserORM(email=email.lower(), password_hash=password_hash)
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return row

    async def touch_last_seen(self, user_id: str) -> None:
        row = await self.get(user_id)
        if row is None:
            return
        row.last_seen_at = datetime.now(UTC)
        await self._db.flush()

    async def counts(self, user_id: str) -> tuple[int, int]:
        briefs = await self._db.scalar(
            select(func.count()).select_from(BriefORM).where(BriefORM.user_id == user_id)
        )
        jobs = await self._db.scalar(
            select(func.count())
            .select_from(ResearchJobORM)
            .where(ResearchJobORM.user_id == user_id)
        )
        return int(briefs or 0), int(jobs or 0)

    async def recent_briefs(self, user_id: str, *, limit: int = 5) -> Sequence[BriefORM]:
        result = await self._db.execute(
            select(BriefORM)
            .where(BriefORM.user_id == user_id)
            .order_by(BriefORM.updated_at.desc())
            .limit(limit)
        )
        return result.scalars().all()


class BriefRepository:
    """All brief reads/writes are scoped to a user_id. Cross-user access
    returns nothing — the service translates that to a 404."""

    def __init__(self, db: AsyncSession, user_id: str) -> None:
        self._db = db
        self._user_id = user_id

    async def create(
        self,
        *,
        company_name: str,
        website: str,
        objective: str,
        brief_id: str | None = None,
        title: str | None = None,
    ) -> BriefORM:
        row = BriefORM(
            user_id=self._user_id,
            company_name=company_name,
            website=website,
            objective=objective,
            title=title or f"{company_name} research",
        )
        if brief_id:
            row.id = brief_id
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return row

    async def get(self, brief_id: str) -> BriefORM | None:
        result = await self._db.execute(
            select(BriefORM).where(
                BriefORM.id == brief_id,
                BriefORM.user_id == self._user_id,
            )
        )
        return result.scalar_one_or_none()

    async def list(
        self, *, limit: int = 50, offset: int = 0
    ) -> tuple[Sequence[BriefORM], int]:
        total = await self._db.scalar(
            select(func.count())
            .select_from(BriefORM)
            .where(BriefORM.user_id == self._user_id)
        )
        result = await self._db.execute(
            select(BriefORM)
            .where(BriefORM.user_id == self._user_id)
            .order_by(BriefORM.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return result.scalars().all(), int(total or 0)

    async def set_status(self, brief_id: str, status: str) -> BriefORM | None:
        row = await self.get(brief_id)
        if row is None:
            return None
        row.status = status
        await self._db.flush()
        await self._db.refresh(row)
        return row

    async def set_clarification_question(
        self, brief_id: str, questions: list[dict]
    ) -> BriefORM | None:
        row = await self.get(brief_id)
        if row is None:
            return None
        # A re-emit (reload/subscribe) must not wipe answers already given.
        if row.clarification_question and row.clarification_question.get("answered"):
            return row
        row.clarification_question = {"answered": False, "questions": questions}
        await self._db.flush()
        return row

    async def mark_clarification_answered(
        self, brief_id: str, answers: list[dict] | None = None
    ) -> BriefORM | None:
        """Flip the gate to answered and, when provided, store each user answer
        against its question (matched by question text)."""
        row = await self.get(brief_id)
        if row is None or not row.clarification_question:
            return row
        cq = {**row.clarification_question, "answered": True}
        if answers:
            by_question = {a["question"]: a["answer"] for a in answers}
            cq["questions"] = [
                {**q, "answer": by_question.get(q.get("question"))}
                for q in cq.get("questions", [])
            ]
        row.clarification_question = cq
        flag_modified(row, "clarification_question")
        await self._db.flush()
        return row


class MessageRepository:
    """Chat history for a brief. Scoped to a brief_id — callers are expected
    to have already verified ownership via BriefRepository."""

    def __init__(self, db: AsyncSession, brief_id: str) -> None:
        self._db = db
        self._brief_id = brief_id

    async def list(self, *, kind: str | None = None) -> Sequence[MessageORM]:
        stmt = select(MessageORM).where(MessageORM.brief_id == self._brief_id)
        if kind is not None:
            stmt = stmt.where(MessageORM.kind == kind)
        result = await self._db.execute(stmt.order_by(MessageORM.created_at))
        return result.scalars().all()

    async def add(self, *, role: str, content: str, kind: str) -> MessageORM:
        row = MessageORM(
            brief_id=self._brief_id, role=role, content=content, kind=kind
        )
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return row
