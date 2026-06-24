import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, String, Text
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
    email: Mapped[str] = mapped_column(
        String(320), nullable=False, unique=True, index=True
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
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
    """A brief IS a chat thread. `id` is the LangGraph thread_id.

    Conversation messages live both in the LangGraph checkpointer and the
    `messages` table. `clarification_question` holds the gate's questions plus
    an `answered` flag so we don't re-prompt the user on reload.
    """

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
    # {"answered": bool, "questions": [...]} — null until the gate asks.
    clarification_question: Mapped[dict | None] = mapped_column(JSON, nullable=True)
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
    messages: Mapped[list["MessageORM"]] = relationship(
        back_populates="brief",
        cascade="all, delete-orphan",
        order_by="MessageORM.created_at",
        lazy="selectin",
    )


class MessageORM(Base):
    """Chat turns for a brief: phase-1 intro/clarification plus post-report follow-ups."""

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    brief_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("briefs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # 'user' | 'assistant'
    kind: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="followup", index=True
    )  # 'workflow' (phase-1 flow) | 'followup' (post-report chat)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    brief: Mapped[BriefORM] = relationship(back_populates="messages")


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
    final_report: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources: Mapped[list | None] = mapped_column(JSON, nullable=True)
    report_pdf_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    brief: Mapped[BriefORM] = relationship(back_populates="jobs")
    events: Mapped[list["ResearchJobEventORM"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="ResearchJobEventORM.id",
    )
    researchers: Mapped[list["ResearchJobResearcherORM"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="ResearchJobResearcherORM.id",
    )
    tasks: Mapped[list["ResearchTaskORM"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="ResearchTaskORM.created_at",
    )


class ResearchJobEventORM(Base):
    __tablename__ = "research_job_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("research_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    job: Mapped[ResearchJobORM] = relationship(back_populates="events")


class ResearchJobResearcherORM(Base):
    __tablename__ = "research_job_researchers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("research_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    topic: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    job: Mapped[ResearchJobORM] = relationship(back_populates="researchers")


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
