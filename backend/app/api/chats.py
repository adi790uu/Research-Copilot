from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.domain.chat import Chat, ChatCreate, ChatWithMessages
from app.domain.message import Message, MessageCreate
from app.persistence.db import get_db_session
from app.services.chat_service import ChatService

router = APIRouter(prefix="/chats", tags=["chats"])


@router.post("", response_model=Chat, status_code=status.HTTP_201_CREATED)
async def create_chat(
    payload: ChatCreate,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> Chat:
    return await ChatService(db, user).create(payload)


@router.get("", response_model=list[Chat])
async def list_chats(
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> list[Chat]:
    return await ChatService(db, user).list(limit=limit)


@router.get("/{chat_id}", response_model=ChatWithMessages)
async def get_chat(
    chat_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> ChatWithMessages:
    return await ChatService(db, user).get(chat_id)


@router.post("/{chat_id}/messages", response_model=Message, status_code=status.HTTP_201_CREATED)
async def add_message(
    chat_id: str,
    payload: MessageCreate,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> Message:
    return await ChatService(db, user).add_user_message(chat_id, payload)
