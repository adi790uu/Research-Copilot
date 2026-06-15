from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.domain.message import Message


class ChatCreate(BaseModel):
    title: str = Field(default="Untitled chat", min_length=1, max_length=200)
    session_id: str | None = Field(default=None, min_length=1, max_length=32)


class Chat(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    session_id: str | None
    title: str
    created_at: datetime
    updated_at: datetime


class ChatWithMessages(Chat):
    messages: list[Message] = Field(default_factory=list)
