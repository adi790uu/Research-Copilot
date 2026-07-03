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
    """One dynamically-chosen section of the final brief."""

    heading: str
    content: str
    source_ids: list[str] = Field(default_factory=list)


class ReportContent(BaseModel):
    """The final brief. Sections are chosen by the writer to best satisfy the
    research goal, not fixed to a template. Order is the render order (PDF /
    artifact panel)."""

    summary: str = ""
    sections: list[ReportSection] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)


class Report(BaseModel):
    """Lightweight envelope used by the API layer when surfacing a report
    on its own (rather than embedded in a `research_jobs` row)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    brief_id: str
    content: ReportContent
    created_at: datetime
