from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.core.errors import NotFoundError
from app.domain.chat import Chat, ChatCreate, ChatWithMessages
from app.domain.message import Message, MessageCreate, MessageRole
from app.persistence.repositories import ChatRepository, SessionRepository, UserRepository


class ChatService:
    def __init__(self, db: AsyncSession, user: CurrentUser) -> None:
        self._db = db
        self._user = user
        self._repo = ChatRepository(db, user.id)
        self._sessions = SessionRepository(db, user.id)
        self._users = UserRepository(db)

    async def create(self, payload: ChatCreate) -> Chat:
        await self._users.upsert_from_auth(self._user)

        if payload.session_id is not None and await self._sessions.get(payload.session_id) is None:
            raise NotFoundError(f"Session {payload.session_id} not found")

        row = await self._repo.create(title=payload.title, session_id=payload.session_id)
        await self._db.commit()
        return Chat.model_validate(row)

    async def get(self, chat_id: str) -> ChatWithMessages:
        await self._users.upsert_from_auth(self._user)
        row = await self._repo.get(chat_id)
        if row is None:
            raise NotFoundError(f"Chat {chat_id} not found")
        await self._db.commit()
        return ChatWithMessages.model_validate(row)

    async def list(self, *, limit: int = 50) -> list[Chat]:
        await self._users.upsert_from_auth(self._user)
        rows = await self._repo.list(limit=limit)
        await self._db.commit()
        return [Chat.model_validate(r) for r in rows]

    async def add_user_message(self, chat_id: str, payload: MessageCreate) -> Message:
        await self._users.upsert_from_auth(self._user)
        row = await self._repo.add_message(
            chat_id=chat_id,
            role=MessageRole.USER.value,
            content=payload.content,
        )
        if row is None:
            raise NotFoundError(f"Chat {chat_id} not found")
        await self._db.commit()
        return Message.model_validate(row)
