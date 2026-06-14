from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class Message(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    role: MessageRole
    content: str
    created_at: datetime
