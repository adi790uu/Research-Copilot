from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.core.errors import NotFoundError
from app.domain.session import Session, SessionCreate
from app.persistence.repositories import SessionRepository, UserRepository


class SessionService:
    def __init__(self, db: AsyncSession, user: CurrentUser) -> None:
        self._db = db
        self._user = user
        self._repo = SessionRepository(db, user.id)
        self._users = UserRepository(db)

    async def create(self, payload: SessionCreate) -> Session:
        await self._users.upsert_from_auth(self._user)
        row = await self._repo.create(
            company_name=payload.company_name,
            website=str(payload.website),
            objective=payload.objective,
        )
        await self._db.commit()
        return Session.model_validate(row)

    async def get(self, session_id: str) -> Session:
        await self._users.upsert_from_auth(self._user)
        row = await self._repo.get(session_id)
        if row is None:
            raise NotFoundError(f"Session {session_id} not found")
        await self._db.commit()
        return Session.model_validate(row)

    async def list(self, *, limit: int = 50) -> list[Session]:
        await self._users.upsert_from_auth(self._user)
        rows = await self._repo.list(limit=limit)
        await self._db.commit()
        return [Session.model_validate(r) for r in rows]
