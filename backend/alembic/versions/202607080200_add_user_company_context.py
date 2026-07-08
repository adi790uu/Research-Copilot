"""add users.company_context

The seller's own company profile (what they sell, value props, ICP,
differentiators, proof points). Reused across researches; drives the pitch.

Revision ID: 202607080200
Revises: 202607080100
Create Date: 2026-07-08 12:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '202607080200'
down_revision: str | Sequence[str] | None = '202607080100'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('company_context', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'company_context')
