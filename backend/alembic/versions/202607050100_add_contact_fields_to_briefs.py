"""add meeting-contact fields to briefs

Revision ID: 202607050100
Revises: 202606240100
Create Date: 2026-07-05 01:00:00.000000

Person-level enrichment: briefs may optionally name a meeting contact
(contact_name/contact_email), and carry the resolved identity found via
People Data Labs (contact_resolution — status/source/likelihood/title/
company/linkedin_url/location). All nullable; existing rows are unaffected.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202607050100"
down_revision: str | Sequence[str] | None = "202606240100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("briefs", sa.Column("contact_name", sa.String(length=200), nullable=True))
    op.add_column("briefs", sa.Column("contact_email", sa.String(length=320), nullable=True))
    op.add_column("briefs", sa.Column("contact_resolution", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("briefs", "contact_resolution")
    op.drop_column("briefs", "contact_email")
    op.drop_column("briefs", "contact_name")
