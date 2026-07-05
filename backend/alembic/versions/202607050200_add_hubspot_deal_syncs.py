"""add hubspot_deal_syncs table

Revision ID: 202607050200
Revises: 202607050100
Create Date: 2026-07-05 02:00:00.000000

Tracks HubSpot deals picked up for automatic research so a poll cycle never
re-processes the same deal twice, and so the write-back step (a Note with the
dashboard link) knows which briefs/jobs originated from the CRM sync.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202607050200"
down_revision: str | Sequence[str] | None = "202607050100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hubspot_deal_syncs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("deal_id", sa.String(length=64), nullable=False),
        sa.Column("brief_id", sa.String(length=32), nullable=True),
        sa.Column("job_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_hubspot_deal_syncs_deal_id", "hubspot_deal_syncs", ["deal_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_hubspot_deal_syncs_deal_id", table_name="hubspot_deal_syncs")
    op.drop_table("hubspot_deal_syncs")
