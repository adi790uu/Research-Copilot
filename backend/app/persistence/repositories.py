from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.persistence.models import ChatORM, MessageORM, ReportORM, SessionORM, UserORM


class UserRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def upsert_from_auth(self, user: CurrentUser) -> UserORM:
        row = await self.get(user.id)
        if row is None:
            row = UserORM(id=user.id, email=user.email)
            self._db.add(row)
        else:
            row.email = user.email
            row.last_seen_at = func.now()

        await self._db.flush()
        await self._db.refresh(row)
        return row

    async def get(self, user_id: str) -> UserORM | None:
        result = await self._db.execute(select(UserORM).where(UserORM.id == user_id))
        return result.scalar_one_or_none()

    async def counts(self, user_id: str) -> tuple[int, int, int]:
        sessions = await self._db.scalar(
            select(func.count()).select_from(SessionORM).where(SessionORM.user_id == user_id)
        )
        chats = await self._db.scalar(
            select(func.count()).select_from(ChatORM).where(ChatORM.user_id == user_id)
        )
        messages = await self._db.scalar(
            select(func.count())
            .select_from(MessageORM)
            .join(ChatORM, MessageORM.chat_id == ChatORM.id)
            .where(ChatORM.user_id == user_id)
        )
        return int(sessions or 0), int(chats or 0), int(messages or 0)

    async def recent_sessions(self, user_id: str, *, limit: int = 5) -> Sequence[SessionORM]:
        result = await self._db.execute(
            select(SessionORM)
            .where(SessionORM.user_id == user_id)
            .order_by(SessionORM.created_at.desc())
            .limit(limit)
        )
        return result.scalars().all()

    async def recent_chats(self, user_id: str, *, limit: int = 5) -> Sequence[ChatORM]:
        result = await self._db.execute(
            select(ChatORM)
            .where(ChatORM.user_id == user_id)
            .order_by(ChatORM.updated_at.desc())
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

    async def set_status(self, session_id: str, status: str) -> SessionORM | None:
        row = await self.get(session_id)
        if row is None:
            return None
        row.status = status
        await self._db.flush()
        await self._db.refresh(row)
        return row


class ReportRepository:
    """Reports are scoped to a user via their parent session. The caller is
    expected to verify session ownership before writing here."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def upsert(self, *, session_id: str, content: dict) -> ReportORM:
        existing = await self.get_by_session(session_id)
        if existing is None:
            row = ReportORM(session_id=session_id, content=content)
            self._db.add(row)
        else:
            existing.content = content
            row = existing
        await self._db.flush()
        await self._db.refresh(row)
        return row

    async def get_by_session(self, session_id: str) -> ReportORM | None:
        result = await self._db.execute(
            select(ReportORM).where(ReportORM.session_id == session_id)
        )
        return result.scalar_one_or_none()


class ChatRepository:
    def __init__(self, db: AsyncSession, user_id: str) -> None:
        self._db = db
        self._user_id = user_id

    async def create(self, *, title: str, session_id: str | None = None) -> ChatORM:
        row = ChatORM(user_id=self._user_id, session_id=session_id, title=title)
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return row

    async def get(self, chat_id: str) -> ChatORM | None:
        result = await self._db.execute(
            select(ChatORM).where(ChatORM.id == chat_id, ChatORM.user_id == self._user_id)
        )
        return result.scalar_one_or_none()

    async def list(self, *, limit: int = 50) -> Sequence[ChatORM]:
        result = await self._db.execute(
            select(ChatORM)
            .where(ChatORM.user_id == self._user_id)
            .order_by(ChatORM.updated_at.desc())
            .limit(limit)
        )
        return result.scalars().all()

    async def add_message(
        self, *, chat_id: str, role: str, content: str
    ) -> MessageORM | None:
        chat = await self.get(chat_id)
        if chat is None:
            return None

        row = MessageORM(chat_id=chat_id, role=role, content=content)
        self._db.add(row)
        chat.updated_at = func.now()
        await self._db.flush()
        await self._db.refresh(row)
        return row
