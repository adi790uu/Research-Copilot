from collections.abc import AsyncIterator
from functools import lru_cache

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.core.config import get_settings
from app.domain.chat import Chat, ChatCreate, ChatWithMessages
from app.domain.message import Message, MessageCreate
from app.persistence.db import get_db_session
from app.providers.factory import build_providers
from app.providers.llm.base import LLMProvider
from app.services.chat_service import ChatService

router = APIRouter(prefix="/chats", tags=["chats"])


@lru_cache(maxsize=1)
def _build_llm() -> LLMProvider:
    llm, _search = build_providers(get_settings())
    return llm


def get_llm_provider() -> LLMProvider:
    return _build_llm()


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


@router.post("/{chat_id}/messages/stream")
async def stream_message(
    chat_id: str,
    payload: MessageCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
    llm: LLMProvider = Depends(get_llm_provider),
) -> StreamingResponse:
    """POST a user message; stream the assistant reply token-by-token as SSE.

    Frames:
      - `event: token\\ndata: <text>\\n\\n` for each chunk
      - `event: done\\ndata: {}\\n\\n` when the reply is complete
    """
    service = ChatService(db, user, llm=llm)
    token_iter = service.answer_stream(chat_id, payload)

    async def generator() -> AsyncIterator[bytes]:
        try:
            async for chunk in token_iter:
                if await request.is_disconnected():
                    break
                yield f"event: token\ndata: {_sse_escape(chunk)}\n\n".encode()
            yield b"event: done\ndata: {}\n\n"
        finally:
            await token_iter.aclose()

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _sse_escape(text: str) -> str:
    # SSE 'data:' lines cannot contain raw newlines — split into multiple data lines.
    return text.replace("\r\n", "\n").replace("\n", "\ndata: ")
