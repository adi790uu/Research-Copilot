"""add kind discriminator to messages

Revision ID: 202606240100
Revises: 202606220100
Create Date: 2026-06-24 01:00:00.000000

Separates the two conversations stored in `messages`: the phase-1 workflow
flow (intro + clarification answers) and the post-report follow-up chat. New
rows are tagged explicitly; existing phase-1 rows are backfilled by content.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202606240100"
down_revision: str | Sequence[str] | None = "202606220100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="followup"),
    )
    op.create_index("ix_messages_kind", "messages", ["kind"])
    # Phase-1 turns: the user's labeled intro + clarification answers, plus
    # legacy clarification questions that older builds stored as assistant
    # JSON messages (current builds keep these on the brief instead).
    op.execute(
        """
        UPDATE messages SET kind = 'workflow'
        WHERE (role = 'user'
               AND (content LIKE 'Company Name:%'
                    OR content LIKE '%Clarification answer:%'))
           OR (role = 'assistant' AND content LIKE '{%"type": "clarification"%')
        """
    )


def downgrade() -> None:
    op.drop_index("ix_messages_kind", table_name="messages")
    op.drop_column("messages", "kind")
