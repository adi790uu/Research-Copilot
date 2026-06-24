from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


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


class Brief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_name: str
    website: str
    objective: str
    status: BriefStatus
    # {"answered": bool, "questions": [...]} — null until the gate asks.
    clarification_question: dict | None = None
    created_at: datetime
    updated_at: datetime


class BriefPage(BaseModel):
    """Paginated brief list. `total` is the unfiltered count so the frontend
    can render a page count without a second round-trip."""

    items: list[Brief]
    total: int
    limit: int
    offset: int
