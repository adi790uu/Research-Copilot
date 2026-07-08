"""split research_jobs report into company_report / person_report / pitch

The single ``final_report`` (+ ``sources``) is replaced by three artifacts:
- ``company_report``: factual company research (carries the summary + sources)
- ``person_report``: the named meeting contact (null when there's no contact)
- ``pitch``: sales pitch built from the research + seller context (null when
  the seller has no company context)

Revision ID: 202607080300
Revises: 202607080200
Create Date: 2026-07-08 13:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '202607080300'
down_revision: str | Sequence[str] | None = '202607080200'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('research_jobs', sa.Column('company_report', sa.Text(), nullable=True))
    op.add_column('research_jobs', sa.Column('person_report', sa.Text(), nullable=True))
    op.add_column('research_jobs', sa.Column('pitch', sa.Text(), nullable=True))
    op.drop_column('research_jobs', 'final_report')
    op.drop_column('research_jobs', 'sources')


def downgrade() -> None:
    op.add_column('research_jobs', sa.Column('final_report', sa.Text(), nullable=True))
    op.add_column('research_jobs', sa.Column('sources', sa.JSON(), nullable=True))
    op.drop_column('research_jobs', 'pitch')
    op.drop_column('research_jobs', 'person_report')
    op.drop_column('research_jobs', 'company_report')
