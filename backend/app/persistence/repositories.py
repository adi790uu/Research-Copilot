from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.persistence.models import (
    ResearchJobORM,
    SessionMessageORM,
    SessionORM,
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
        sessions = await self._db.scalar(
            select(func.count()).select_from(SessionORM).where(SessionORM.user_id == user_id)
        )
        jobs = await self._db.scalar(
            select(func.count())
            .select_from(ResearchJobORM)
            .where(ResearchJobORM.user_id == user_id)
        )
        return int(sessions or 0), int(jobs or 0)

    async def recent_sessions(self, user_id: str, *, limit: int = 5) -> Sequence[SessionORM]:
        result = await self._db.execute(
            select(SessionORM)
            .where(SessionORM.user_id == user_id)
            .order_by(SessionORM.updated_at.desc())
            .limit(limit)
        )
        return result.scalars().all()


class SessionRepository:
    """All session reads/writes are scoped to a user_id. Cross-user access
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
        session_id: str | None = None,
        title: str | None = None,
    ) -> SessionORM:
        row = SessionORM(
            user_id=self._user_id,
            company_name=company_name,
            website=website,
            objective=objective,
            title=title or f"{company_name} research",
        )
        if session_id:
            row.id = session_id
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return row

    async def get(self, session_id: str) -> SessionORM | None:
        result = await self._db.execute(
            select(SessionORM).where(
                SessionORM.id == session_id,
                SessionORM.user_id == self._user_id,
            )
        )
        return result.scalar_one_or_none()

    async def list(
        self, *, limit: int = 50, offset: int = 0
    ) -> tuple[Sequence[SessionORM], int]:
        total = await self._db.scalar(
            select(func.count())
            .select_from(SessionORM)
            .where(SessionORM.user_id == self._user_id)
        )
        result = await self._db.execute(
            select(SessionORM)
            .where(SessionORM.user_id == self._user_id)
            .order_by(SessionORM.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return result.scalars().all(), int(total or 0)

    async def set_status(self, session_id: str, status: str) -> SessionORM | None:
        row = await self.get(session_id)
        if row is None:
            return None
        row.status = status
        await self._db.flush()
        await self._db.refresh(row)
        return row


class SessionMessageRepository:
    """Follow-up chat history (post-report). Scoped to a session — callers
    are expected to have already verified ownership via SessionRepository."""

    def __init__(self, db: AsyncSession, session_id: str) -> None:
        self._db = db
        self._session_id = session_id

    async def list(self) -> Sequence[SessionMessageORM]:
        result = await self._db.execute(
            select(SessionMessageORM)
            .where(SessionMessageORM.session_id == self._session_id)
            .order_by(SessionMessageORM.created_at)
        )
        return result.scalars().all()

    async def add(self, *, role: str, content: str) -> SessionMessageORM:
        row = SessionMessageORM(
            session_id=self._session_id, role=role, content=content
        )
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return row
