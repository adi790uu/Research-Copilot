from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, UnauthorizedError
from app.domain.session import Session
from app.domain.user import ActivitySummary, User
from app.persistence.repositories import UserRepository


class UserService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._repo = UserRepository(db)

    async def me(self, current_user: CurrentUser) -> User:
        row = await self._repo.get(current_user.id)
        if row is None:
            # JWT was valid but the row is gone — treat as a stale token.
            raise UnauthorizedError("User no longer exists")
        await self._repo.touch_last_seen(current_user.id)
        await self._db.commit()
        return User.model_validate(row)

    async def activity(self, current_user: CurrentUser) -> ActivitySummary:
        row = await self._repo.get(current_user.id)
        if row is None:
            raise UnauthorizedError("User no longer exists")
        session_count, job_count = await self._repo.counts(current_user.id)
        recent_sessions = await self._repo.recent_sessions(current_user.id)
        await self._repo.touch_last_seen(current_user.id)
        await self._db.commit()
        return ActivitySummary(
            user=User.model_validate(row),
            session_count=session_count,
            job_count=job_count,
            recent_sessions=[Session.model_validate(s) for s in recent_sessions],
        )
