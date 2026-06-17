"""session_messages followup chat

Revision ID: 202606170100
Revises: 202606160200
Create Date: 2026-06-17 12:40:42.603073

Adds the session_messages table for follow-up chat over a finished brief.
The autogenerate diff also wanted to drop the LangGraph checkpointer
tables (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`,
`checkpoint_migrations`) since they're not in our SQLAlchemy metadata —
those are owned by `AsyncPostgresSaver` and recreated on startup, so we
intentionally leave them alone.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202606170100"
down_revision: str | Sequence[str] | None = "202606160200"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "session_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=32), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_session_messages_session_id"),
        "session_messages",
        ["session_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_session_messages_session_id"), table_name="session_messages"
    )
    op.drop_table("session_messages")
