from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.domain.brief import Brief


class CompanyContext(BaseModel):
    """The seller's own company profile, used to build the pitch. All fields are
    optional; a pitch is generated only when at least one is filled in."""

    what_you_sell: str = ""
    value_props: str = ""
    icp: str = ""
    differentiators: str = ""
    proof_points: str = ""
    notes: str = ""

    def is_empty(self) -> bool:
        return not any(
            v.strip()
            for v in (
                self.what_you_sell,
                self.value_props,
                self.icp,
                self.differentiators,
                self.proof_points,
                self.notes,
            )
        )


class User(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    company_context: CompanyContext | None = None
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
