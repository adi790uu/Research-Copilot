from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SourceType = Literal["company_site", "web", "linkedin", "twitter", "reddit", "social"]


class Source(BaseModel):
    id: str
    url: str
    title: str
    snippet: str | None = None
    section: str | None = None
    type: SourceType | None = None


class ReportSection(BaseModel):
    heading: str
    content: str
    source_ids: list[str] = Field(default_factory=list)


class ReportContent(BaseModel):
    summary: str = ""
    sections: list[ReportSection] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)


class Report(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    brief_id: str
    content: ReportContent
    created_at: datetime
