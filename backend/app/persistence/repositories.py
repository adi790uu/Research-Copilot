from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.persistence.models import (
    BriefORM,
    ChatORM,
    HubspotDealSyncORM,
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
        result = await self._db.execute(select(UserORM).where(UserORM.email == email.lower()))
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
        contact_name: str | None = None,
        contact_email: str | None = None,
    ) -> BriefORM:
        row = BriefORM(
            user_id=self._user_id,
            company_name=company_name,
            website=website,
            objective=objective,
            title=title or f"{company_name} research",
            contact_name=contact_name,
            contact_email=contact_email,
        )
        if brief_id:
            row.id = brief_id
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return row

    async def set_contact_resolution(self, brief_id: str, resolution: dict) -> BriefORM | None:
        row = await self.get(brief_id)
        if row is None:
            return None
        row.contact_resolution = resolution
        flag_modified(row, "contact_resolution")
        await self._db.flush()
        return row

    async def get(self, brief_id: str) -> BriefORM | None:
        result = await self._db.execute(
            select(BriefORM).where(
                BriefORM.id == brief_id,
                BriefORM.user_id == self._user_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_many(self, brief_ids: list[str]) -> list[BriefORM]:
        """Fetch several owned briefs in one query, returned in the caller's order.
        Ids that don't exist or aren't owned by this user are silently dropped."""
        if not brief_ids:
            return []
        result = await self._db.execute(
            select(BriefORM).where(
                BriefORM.id.in_(brief_ids),
                BriefORM.user_id == self._user_id,
            )
        )
        by_id = {row.id: row for row in result.scalars().all()}
        return [by_id[bid] for bid in brief_ids if bid in by_id]

    async def list(self, *, limit: int = 50, offset: int = 0) -> tuple[Sequence[BriefORM], int]:
        total = await self._db.scalar(
            select(func.count()).select_from(BriefORM).where(BriefORM.user_id == self._user_id)
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
        if row.clarification_question and row.clarification_question.get("answered"):
            return row
        row.clarification_question = {"answered": False, "questions": questions}
        await self._db.flush()
        return row

    async def mark_clarification_answered(
        self, brief_id: str, answers: list[dict] | None = None
    ) -> BriefORM | None:
        row = await self.get(brief_id)
        if row is None or not row.clarification_question:
            return row
        cq = {**row.clarification_question, "answered": True}
        if answers:
            by_question = {a["question"]: a["answer"] for a in answers}
            cq["questions"] = [
                {**q, "answer": by_question.get(q.get("question"))} for q in cq.get("questions", [])
            ]
        row.clarification_question = cq
        flag_modified(row, "clarification_question")
        await self._db.flush()
        return row


class HubspotDealSyncRepository:
    """No user scoping — this is a service-level table the CRM sync loop owns,
    not a per-user resource reached through the API."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_by_deal(self, deal_id: str) -> HubspotDealSyncORM | None:
        result = await self._db.execute(
            select(HubspotDealSyncORM).where(HubspotDealSyncORM.deal_id == deal_id)
        )
        return result.scalar_one_or_none()

    async def create(self, *, deal_id: str) -> HubspotDealSyncORM:
        row = HubspotDealSyncORM(deal_id=deal_id, status="pending")
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return row

    async def mark_researching(self, sync_id: str, *, brief_id: str, job_id: str) -> None:
        row = await self._db.get(HubspotDealSyncORM, sync_id)
        if row is None:
            return
        row.brief_id = brief_id
        row.job_id = job_id
        row.status = "researching"
        await self._db.flush()

    async def mark_failed(self, sync_id: str, *, error: str) -> None:
        row = await self._db.get(HubspotDealSyncORM, sync_id)
        if row is None:
            return
        row.status = "failed"
        row.error = error[:2000]
        await self._db.flush()

    async def mark_completed(self, sync_id: str) -> None:
        row = await self._db.get(HubspotDealSyncORM, sync_id)
        if row is None:
            return
        row.status = "completed"
        await self._db.flush()

    async def list_researching(self) -> Sequence[HubspotDealSyncORM]:
        result = await self._db.execute(
            select(HubspotDealSyncORM).where(HubspotDealSyncORM.status == "researching")
        )
        return result.scalars().all()


class MessageRepository:
    """Messages scoped to one Copilot chat."""

    def __init__(self, db: AsyncSession, chat_id: str) -> None:
        self._db = db
        self._chat_id = chat_id

    async def list(self) -> Sequence[MessageORM]:
        result = await self._db.execute(
            select(MessageORM)
            .where(MessageORM.chat_id == self._chat_id)
            .order_by(MessageORM.created_at)
        )
        return result.scalars().all()

    async def add(self, *, role: str, content: str) -> MessageORM:
        row = MessageORM(chat_id=self._chat_id, role=role, content=content)
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return row


class ChatRepository:
    """Copilot conversations, scoped to a user."""

    def __init__(self, db: AsyncSession, user_id: str) -> None:
        self._db = db
        self._user_id = user_id

    async def get(self, chat_id: str) -> ChatORM | None:
        result = await self._db.execute(
            select(ChatORM).where(
                ChatORM.id == chat_id,
                ChatORM.user_id == self._user_id,
            )
        )
        return result.scalar_one_or_none()

    async def list(self, *, limit: int = 20, offset: int = 0) -> tuple[Sequence[ChatORM], int]:
        total = await self._db.scalar(
            select(func.count()).select_from(ChatORM).where(ChatORM.user_id == self._user_id)
        )
        result = await self._db.execute(
            select(ChatORM)
            .where(ChatORM.user_id == self._user_id)
            .order_by(ChatORM.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return result.scalars().all(), int(total or 0)

    async def create(self, chat_id: str, *, title: str = "New chat") -> ChatORM:
        row = ChatORM(id=chat_id, user_id=self._user_id, title=title)
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return row

    async def touch(self, chat_id: str) -> None:
        chat = await self.get(chat_id)
        if chat is None:
            return
        chat.updated_at = datetime.now(UTC)
        await self._db.flush()

    async def delete(self, chat_id: str) -> bool:
        chat = await self.get(chat_id)
        if chat is None:
            return False
        await self._db.delete(chat)
        await self._db.flush()
        return True
