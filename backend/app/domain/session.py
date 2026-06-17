from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class SessionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    AWAITING_CLARIFICATION = "awaiting_clarification"
    AWAITING_PLAN_APPROVAL = "awaiting_plan_approval"
    COMPLETED = "completed"
    FAILED = "failed"


class SessionCreate(BaseModel):
    company_name: str = Field(min_length=1, max_length=200)
    website: HttpUrl
    objective: str = Field(min_length=1, max_length=2000)


class Session(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_name: str
    website: str
    objective: str
    status: SessionStatus
    created_at: datetime
    updated_at: datetime


class SessionPage(BaseModel):
    """Paginated session list. `total` is the unfiltered count so the
    frontend can render a page count without a second round-trip."""

    items: list[Session]
    total: int
    limit: int
    offset: int
