from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class Source(BaseModel):
    id: str
    url: str
    title: str
    snippet: str | None = None


class ReportSection(BaseModel):
    content: str
    source_ids: list[str] = Field(default_factory=list)


class ReportContent(BaseModel):
    """All sections required by the assignment brief."""

    company_overview: ReportSection
    products_and_services: ReportSection
    target_customers: ReportSection
    business_signals: ReportSection
    risks_and_challenges: ReportSection
    discovery_questions: ReportSection
    outreach_strategy: ReportSection
    unknowns: ReportSection
    sources: list[Source] = Field(default_factory=list)


class Report(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    content: ReportContent
    created_at: datetime
