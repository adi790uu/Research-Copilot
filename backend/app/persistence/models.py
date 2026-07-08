import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid() -> str:
    return uuid.uuid4().hex


def _utcnow() -> datetime:
    return datetime.now(UTC)


class UserORM(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # The seller's own company profile, reused across researches to build pitches.
    company_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    briefs: Mapped[list["BriefORM"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class BriefORM(Base):
    __tablename__ = "briefs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    company_name: Mapped[str] = mapped_column(String(200), nullable=False)
    website: Mapped[str] = mapped_column(String(2048), nullable=False)
    objective: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="New research")
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="pending")
    clarification_question: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # The generated research plan, persisted once it's ready so the brief can be
    # reopened at the approval step without re-reading the LangGraph checkpoint.
    research_plan: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    contact_resolution: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    user: Mapped[UserORM] = relationship(back_populates="briefs")
    jobs: Mapped[list["ResearchJobORM"]] = relationship(
        back_populates="brief",
        cascade="all, delete-orphan",
        order_by="ResearchJobORM.created_at.desc()",
        lazy="selectin",
    )


class ChatORM(Base):
    """A Copilot conversation. Scoped to a user. The set of researches to ground
    on is supplied by the client with each message (not persisted), so the chat
    only owns its message history. The client generates the id so a fresh thread
    can start streaming before its first turn is persisted."""

    __tablename__ = "chats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="New chat")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    messages: Mapped[list["MessageORM"]] = relationship(
        back_populates="chat",
        cascade="all, delete-orphan",
        order_by="MessageORM.created_at",
        lazy="selectin",
    )


class MessageORM(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    chat_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("chats.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    chat: Mapped[ChatORM] = relationship(back_populates="messages")


class ResearchJobORM(Base):
    __tablename__ = "research_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    brief_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("briefs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    research_plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Factual company research (carries the summary + sources).
    company_report: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Named meeting contact (null when there's no contact).
    person_report: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Sales pitch (null when the seller has no company context).
    pitch: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    brief: Mapped[BriefORM] = relationship(back_populates="jobs")
    tasks: Mapped[list["ResearchTaskORM"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="ResearchTaskORM.created_at",
    )


class HubspotDealSyncORM(Base):
    """One row per HubSpot deal we've picked up for automatic research.
    `deal_id` is unique so a poll cycle never re-processes the same deal.
    `status` walks pending -> researching -> completed | failed; write-back
    (the Note with the dashboard link) happens on the researching -> completed
    transition."""

    __tablename__ = "hubspot_deal_syncs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    deal_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    brief_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class ResearchTaskORM(Base):
    __tablename__ = "research_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    job_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("research_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    job: Mapped[ResearchJobORM] = relationship(back_populates="tasks")
