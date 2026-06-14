from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class SessionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
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
