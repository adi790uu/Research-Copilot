from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.domain.session import Session, SessionCreate
from app.persistence.repositories import SessionRepository


class SessionService:
    def __init__(self, db: AsyncSession, user_id: str) -> None:
        self._db = db
        self._user_id = user_id
        self._repo = SessionRepository(db, user_id)

    async def create(self, payload: SessionCreate) -> Session:
        row = await self._repo.create(
            company_name=payload.company_name,
            website=str(payload.website),
            objective=payload.objective,
        )
        await self._db.commit()
        return Session.model_validate(row)

    async def get(self, session_id: str) -> Session:
        row = await self._repo.get(session_id)
        if row is None:
            raise NotFoundError(f"Session {session_id} not found")
        return Session.model_validate(row)

    async def list(self, *, limit: int = 50) -> list[Session]:
        rows = await self._repo.list(limit=limit)
        return [Session.model_validate(r) for r in rows]
