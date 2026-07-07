from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl


class BriefStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    AWAITING_CLARIFICATION = "awaiting_clarification"
    AWAITING_PLAN_APPROVAL = "awaiting_plan_approval"
    COMPLETED = "completed"
    FAILED = "failed"


class BriefCreate(BaseModel):
    company_name: str = Field(min_length=1, max_length=200)
    website: HttpUrl
    objective: str = Field(min_length=1, max_length=2000)
    contact_name: str | None = Field(default=None, max_length=200)
    contact_email: EmailStr | None = Field(default=None)


class ContactResolution(BaseModel):
    """Result of the People Data Labs lookup, persisted on the brief. `status`
    is "resolved" (confident match), "unresolved" (no match cleared the
    likelihood threshold), or "skipped" (no API key configured, or no contact
    was given)."""

    status: str
    source: str | None = None
    likelihood: int | None = None
    name: str | None = None
    title: str | None = None
    company: str | None = None
    company_website: str | None = None
    linkedin_url: str | None = None
    location: str | None = None


class Brief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_name: str
    website: str
    objective: str
    status: BriefStatus
    clarification_question: dict | None = None
    research_plan: dict | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_resolution: ContactResolution | None = None
    created_at: datetime
    updated_at: datetime


class BriefPage(BaseModel):
    items: list[Brief]
    total: int
    limit: int
    offset: int
