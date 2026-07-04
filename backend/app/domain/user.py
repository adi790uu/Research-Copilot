from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.domain.brief import Brief


class User(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime


class ActivitySummary(BaseModel):
    user: User
    brief_count: int
    job_count: int
    recent_briefs: list[Brief]


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: User
