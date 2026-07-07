"""add brief research_plan column

Revision ID: 202607070200
Revises: 202607070100
Create Date: 2026-07-07 16:40:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '202607070200'
down_revision: str | Sequence[str] | None = '202607070100'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('briefs', sa.Column('research_plan', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('briefs', 'research_plan')
