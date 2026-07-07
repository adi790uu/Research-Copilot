from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.core.errors import NotFoundError
from app.persistence.db import get_db_session
from app.services import copilot_service

router = APIRouter(prefix="/copilot", tags=["copilot"])


class CopilotChatRequest(BaseModel):
    chat_id: str = Field(min_length=1, max_length=36)
    research_ids: list[str] = Field(default_factory=list)
    message: str = Field(min_length=1, max_length=8000)


def _sse_escape(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\n", "\ndata: ")


@router.post("/chat")
async def copilot_chat(
    payload: CopilotChatRequest,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:
    # No Depends(get_db_session) here: a request-scoped session would stay checked
    # out for the whole SSE stream. stream_chat owns its own short-lived sessions.
    graph = request.app.state.copilot_graph

    async def generator() -> AsyncIterator[bytes]:
        try:
            async for chunk in copilot_service.stream_chat(
                graph=graph,
                user_id=user.id,
                chat_id=payload.chat_id,
                research_ids=payload.research_ids,
                message=payload.message,
            ):
                if await request.is_disconnected():
                    return
                yield f"event: token\ndata: {_sse_escape(chunk)}\n\n".encode()
            yield b"event: done\ndata: {}\n\n"
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).replace("\n", " ")
            yield f"event: error\ndata: {msg}\n\n".encode()

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/chats")
async def list_chats(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return await copilot_service.list_chats(db, user_id=user.id, limit=limit, offset=offset)


@router.get("/chats/{chat_id}")
async def get_chat(
    chat_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    chat = await copilot_service.get_chat(db, user_id=user.id, chat_id=chat_id)
    if chat is None:
        raise NotFoundError(f"Chat {chat_id} not found")
    return chat


@router.delete("/chats/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    deleted = await copilot_service.delete_chat(db, user_id=user.id, chat_id=chat_id)
    if not deleted:
        raise NotFoundError(f"Chat {chat_id} not found")
