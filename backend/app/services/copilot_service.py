from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy.ext.asyncio import AsyncSession

from app.copilot.context import build_research_block, build_system_prompt
from app.copilot.prompts import chat_title_instructions
from app.core.config import get_settings
from app.persistence.db import get_sessionmaker
from app.persistence.repositories import BriefRepository, ChatRepository, MessageRepository
from app.workflow.helpers import _create_model

logger = logging.getLogger(__name__)

_TITLE_MAX = 60


def _title_from(text: str) -> str:
    clean = " ".join(text.split())
    return (clean[:_TITLE_MAX] + "…") if len(clean) > _TITLE_MAX else (clean or "New chat")


async def _generate_title(question: str, answer: str) -> str:
    model = _create_model(model_name=get_settings().openai_title_model)
    prompt = [
        SystemMessage(content=chat_title_instructions),
        HumanMessage(content=f"User: {question}\n\nAssistant: {answer[:600]}"),
    ]
    try:
        resp = await model.ainvoke(prompt)
        title = _extract_text(resp).strip().strip('"').strip()
        return _title_from(title) if title else _title_from(question)
    except Exception:  # noqa: BLE001
        logger.exception("copilot title generation failed")
        return _title_from(question)


def _extract_text(chunk: Any) -> str:
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out: list[str] = []
        for part in content:
            if isinstance(part, str):
                out.append(part)
            elif isinstance(part, dict):
                txt = part.get("text")
                if isinstance(txt, str):
                    out.append(txt)
        return "".join(out)
    return ""


async def list_chats(db: AsyncSession, *, user_id: str) -> list[dict]:
    repo = ChatRepository(db, user_id)
    chats = await repo.list()
    return [
        {
            "id": c.id,
            "title": c.title,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        }
        for c in chats
    ]


async def get_chat(db: AsyncSession, *, user_id: str, chat_id: str) -> dict | None:
    repo = ChatRepository(db, user_id)
    chat = await repo.get(chat_id)
    if chat is None:
        return None
    messages = await MessageRepository(db, chat_id).list()
    return {
        "id": chat.id,
        "title": chat.title,
        "created_at": chat.created_at.isoformat() if chat.created_at else None,
        "updated_at": chat.updated_at.isoformat() if chat.updated_at else None,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
    }


async def delete_chat(db: AsyncSession, *, user_id: str, chat_id: str) -> bool:
    repo = ChatRepository(db, user_id)
    ok = await repo.delete(chat_id)
    if ok:
        await db.commit()
    return ok


async def stream_chat(
    *,
    graph: Any,
    user_id: str,
    chat_id: str,
    research_ids: list[str] = [],
    message: str,
) -> AsyncIterator[str]:
    question = message.strip()

    blocks: list[str] = []
    async with get_sessionmaker()() as db:
        is_new = await ChatRepository(db, user_id).get(chat_id) is None
        briefs = await BriefRepository(db, user_id).get_many(research_ids) if research_ids else []

    if briefs:
        blocks = list(
            await asyncio.gather(
                *(build_research_block(b, i + 1) for i, b in enumerate(briefs))
            )
        )

    config = {
        "configurable": {
            "thread_id": chat_id,
            "system_prompt": build_system_prompt(blocks),
        }
    }

    buffer: list[str] = []
    try:
        try:
            async for chunk, _meta in graph.astream(
                {"messages": [HumanMessage(content=question)]},
                config,
                stream_mode="messages",
            ):
                piece = _extract_text(chunk)
                if not piece:
                    continue
                buffer.append(piece)
                yield piece
        except Exception as exc:  # noqa: BLE001
            logger.exception("copilot stream failed for chat %s", chat_id)
            buffer.append(f"\n\n[stream failed: {exc}]")
            yield f"\n\n[stream failed: {exc}]"
    finally:
        _spawn(
            _persist_turn(
                user_id=user_id,
                chat_id=chat_id,
                question=question,
                answer="".join(buffer).strip(),
                is_new=is_new,
            )
        )


# Keep references to detached persistence tasks so they aren't garbage-collected
# mid-flight; they self-remove on completion.
_background_tasks: set[asyncio.Task] = set()


def _spawn(coro: Any) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def _persist_turn(
    *,
    user_id: str,
    chat_id: str,
    question: str,
    answer: str,
    is_new: bool,
) -> None:
    try:
        title = None
        if is_new:
            title = await _generate_title(question, answer) if answer else _title_from(question)

        async with get_sessionmaker()() as db:
            chat_repo = ChatRepository(db, user_id)
            if is_new:
                await chat_repo.create(chat_id, title=title)
            else:
                await chat_repo.touch(chat_id)

            msg_repo = MessageRepository(db, chat_id)
            await msg_repo.add(role="user", content=question)
            if answer:
                await msg_repo.add(role="assistant", content=answer)
            await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("copilot persistence failed for chat %s", chat_id)
