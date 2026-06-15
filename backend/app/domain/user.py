from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.domain.chat import Chat
from app.domain.session import Session


class User(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str | None
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime


class ActivitySummary(BaseModel):
    user: User
    session_count: int
    chat_count: int
    message_count: int
    recent_sessions: list[Session]
    recent_chats: list[Chat]
