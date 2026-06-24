from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Which tool produced the source. The researcher uses one of two Tavily-backed
# tools (`company_site_search` and `web_company_search`); we tag every Source
# with its origin so the artifact panel's Sources tab can group by channel.
SourceType = Literal["company_site", "web"]


class Source(BaseModel):
    id: str
    url: str
    title: str
    snippet: str | None = None
    # Optional section hint so the artifact panel's Sources tab can group
    # results by subtopic. Not all sources land with one (researchers may
    # be running on generic subtopics without a section assignment), so
    # this stays nullable.
    section: str | None = None
    # Which tool produced this source. None for legacy rows where the
    # type wasn't captured.
    type: SourceType | None = None


class ReportSection(BaseModel):
    """One of the 8 fixed sections of the final brief."""

    content: str
    source_ids: list[str] = Field(default_factory=list)


class ReportContent(BaseModel):
    """All sections required by the assignment brief.

    Order in the file matches the order they render in the PDF / artifact
    panel.
    """

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
    """Lightweight envelope used by the API layer when surfacing a report
    on its own (rather than embedded in a `research_jobs` row)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    brief_id: str
    content: ReportContent
    created_at: datetime
