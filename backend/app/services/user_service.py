from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.domain.chat import Chat
from app.domain.session import Session
from app.domain.user import ActivitySummary, User
from app.persistence.repositories import UserRepository


class UserService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._repo = UserRepository(db)

    async def ensure_user(self, current_user: CurrentUser) -> User:
        row = await self._repo.upsert_from_auth(current_user)
        await self._db.commit()
        return User.model_validate(row)

    async def activity(self, current_user: CurrentUser) -> ActivitySummary:
        row = await self._repo.upsert_from_auth(current_user)
        session_count, chat_count, message_count = await self._repo.counts(current_user.id)
        recent_sessions = await self._repo.recent_sessions(current_user.id)
        recent_chats = await self._repo.recent_chats(current_user.id)
        await self._db.commit()
        return ActivitySummary(
            user=User.model_validate(row),
            session_count=session_count,
            chat_count=chat_count,
            message_count=message_count,
            recent_sessions=[Session.model_validate(s) for s in recent_sessions],
            recent_chats=[Chat.model_validate(c) for c in recent_chats],
        )
