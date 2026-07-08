"""drop research_job_events, research_job_researchers, and research_jobs.report_pdf_key

Progress is tracked tasks-only now; per-topic researcher rows and coarse event
rows are redundant with research_tasks + the final report, and report_pdf_key was
never written (PDFs are rendered on demand).

Revision ID: 202607080100
Revises: 202607070200
Create Date: 2026-07-08 10:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '202607080100'
down_revision: str | Sequence[str] | None = '202607070200'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table('research_job_events')
    op.drop_table('research_job_researchers')
    op.drop_column('research_jobs', 'report_pdf_key')


def downgrade() -> None:
    op.add_column(
        'research_jobs',
        sa.Column('report_pdf_key', sa.String(length=500), nullable=True),
    )
    op.create_table(
        'research_job_researchers',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('job_id', sa.String(length=36), nullable=False),
        sa.Column('topic', sa.Text(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('sources', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['job_id'], ['research_jobs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'idx_research_job_researchers_job_id', 'research_job_researchers', ['job_id']
    )
    op.create_table(
        'research_job_events',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('job_id', sa.String(length=36), nullable=False),
        sa.Column('event_type', sa.String(length=64), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['job_id'], ['research_jobs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_research_job_events_job_id', 'research_job_events', ['job_id'])
