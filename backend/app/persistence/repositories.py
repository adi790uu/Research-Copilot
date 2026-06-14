from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.persistence.models import SessionORM


class SessionRepository:
    """All session reads/writes are scoped to a user_id. Cross-user access
    returns nothing — the service translates that to a 404."""

    def __init__(self, db: AsyncSession, user_id: str) -> None:
        self._db = db
        self._user_id = user_id

    async def create(
        self, *, company_name: str, website: str, objective: str
    ) -> SessionORM:
        row = SessionORM(
            user_id=self._user_id,
            company_name=company_name,
            website=website,
            objective=objective,
        )
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

    async def list(self, *, limit: int = 50) -> Sequence[SessionORM]:
        result = await self._db.execute(
            select(SessionORM)
            .where(SessionORM.user_id == self._user_id)
            .order_by(SessionORM.created_at.desc())
            .limit(limit)
        )
        return result.scalars().all()
