"""rename sessions to briefs, session_messages to messages

Revision ID: 202606220100
Revises: 202606170100
Create Date: 2026-06-22 01:00:00.000000

Renames sessions->briefs and session_messages->messages, renames the
session_id FKs to brief_id, adds briefs.clarification_question, and drops
briefs.last_message. Non-destructive: existing rows are preserved.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202606220100"
down_revision: str | Sequence[str] | None = "202606170100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.rename_table("sessions", "briefs")
    op.rename_table("session_messages", "messages")

    op.alter_column("research_jobs", "session_id", new_column_name="brief_id")
    op.alter_column("messages", "session_id", new_column_name="brief_id")

    op.add_column("briefs", sa.Column("clarification_question", sa.JSON(), nullable=True))
    op.drop_column("briefs", "last_message")

    op.execute("ALTER INDEX ix_sessions_user_id RENAME TO ix_briefs_user_id")
    op.execute("ALTER INDEX ix_research_jobs_session_id RENAME TO ix_research_jobs_brief_id")
    op.execute("ALTER INDEX ix_session_messages_session_id RENAME TO ix_messages_brief_id")


def downgrade() -> None:
    op.execute("ALTER INDEX ix_messages_brief_id RENAME TO ix_session_messages_session_id")
    op.execute("ALTER INDEX ix_research_jobs_brief_id RENAME TO ix_research_jobs_session_id")
    op.execute("ALTER INDEX ix_briefs_user_id RENAME TO ix_sessions_user_id")

    op.add_column(
        "briefs",
        sa.Column("last_message", sa.String(length=500), nullable=False, server_default=""),
    )
    op.alter_column("briefs", "last_message", server_default=None)
    op.drop_column("briefs", "clarification_question")

    op.alter_column("messages", "brief_id", new_column_name="session_id")
    op.alter_column("research_jobs", "brief_id", new_column_name="session_id")

    op.rename_table("messages", "session_messages")
    op.rename_table("briefs", "sessions")
