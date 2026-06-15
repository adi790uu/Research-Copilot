from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.core.errors import NotFoundError
from app.domain.chat import Chat, ChatCreate, ChatWithMessages
from app.domain.message import Message, MessageCreate, MessageRole
from app.domain.report import ReportContent
from app.persistence.repositories import (
    ChatRepository,
    ReportRepository,
    SessionRepository,
    UserRepository,
)
from app.providers.llm.base import LLMProvider


class ChatService:
    def __init__(
        self,
        db: AsyncSession,
        user: CurrentUser,
        llm: LLMProvider | None = None,
    ) -> None:
        self._db = db
        self._user = user
        self._llm = llm
        self._repo = ChatRepository(db, user.id)
        self._sessions = SessionRepository(db, user.id)
        self._users = UserRepository(db)
        self._reports = ReportRepository(db)

    async def create(self, payload: ChatCreate) -> Chat:
        await self._users.upsert_from_auth(self._user)

        if payload.session_id is not None and await self._sessions.get(payload.session_id) is None:
            raise NotFoundError(f"Session {payload.session_id} not found")

        row = await self._repo.create(title=payload.title, session_id=payload.session_id)
        await self._db.commit()
        return Chat.model_validate(row)

    async def get(self, chat_id: str) -> ChatWithMessages:
        await self._users.upsert_from_auth(self._user)
        row = await self._repo.get(chat_id)
        if row is None:
            raise NotFoundError(f"Chat {chat_id} not found")
        await self._db.commit()
        return ChatWithMessages.model_validate(row)

    async def list(self, *, limit: int = 50) -> list[Chat]:
        await self._users.upsert_from_auth(self._user)
        rows = await self._repo.list(limit=limit)
        await self._db.commit()
        return [Chat.model_validate(r) for r in rows]

    async def add_user_message(self, chat_id: str, payload: MessageCreate) -> Message:
        await self._users.upsert_from_auth(self._user)
        row = await self._repo.add_message(
            chat_id=chat_id,
            role=MessageRole.USER.value,
            content=payload.content,
        )
        if row is None:
            raise NotFoundError(f"Chat {chat_id} not found")
        await self._db.commit()
        return Message.model_validate(row)

    async def answer_stream(
        self, chat_id: str, payload: MessageCreate
    ) -> AsyncIterator[str]:
        """Persist the user message, stream an assistant reply token-by-token, then
        persist the final assistant message. Yields plain text chunks; the SSE
        layer wraps them as `data:` frames. If the client disconnects mid-stream,
        whatever was generated so far is still saved."""
        if self._llm is None:
            raise RuntimeError("ChatService.answer_stream requires an LLM provider")

        await self._users.upsert_from_auth(self._user)

        chat = await self._repo.get(chat_id)
        if chat is None:
            raise NotFoundError(f"Chat {chat_id} not found")

        prior = [(m.role, m.content) for m in chat.messages]
        session_id = chat.session_id

        user_msg = await self._repo.add_message(
            chat_id=chat_id,
            role=MessageRole.USER.value,
            content=payload.content,
        )
        if user_msg is None:
            raise NotFoundError(f"Chat {chat_id} not found")
        await self._db.commit()

        context_block = ""
        if session_id is not None:
            report_row = await self._reports.get_by_session(session_id)
            if report_row is not None:
                content = ReportContent.model_validate(report_row.content)
                context_block = _format_report_context(content)

        prompt = _assemble_prompt(context_block, prior, payload.content)

        chunks: list[str] = []
        try:
            async for chunk in self._llm.stream(prompt):
                chunks.append(chunk)
                yield chunk
        finally:
            assistant_content = "".join(chunks).strip() or "(no response)"
            await self._repo.add_message(
                chat_id=chat_id,
                role=MessageRole.ASSISTANT.value,
                content=assistant_content,
            )
            await self._db.commit()


_SECTION_LABELS: dict[str, str] = {
    "company_overview": "Company overview",
    "products_and_services": "Products & services",
    "target_customers": "Target customers",
    "business_signals": "Business signals",
    "risks_and_challenges": "Risks & challenges",
    "discovery_questions": "Discovery questions",
    "outreach_strategy": "Outreach strategy",
    "unknowns": "Unknowns",
}


def _format_report_context(report: ReportContent) -> str:
    parts: list[str] = ["=== BRIEFING ==="]
    for field, label in _SECTION_LABELS.items():
        section = getattr(report, field)
        cite = f" [{','.join(section.source_ids)}]" if section.source_ids else ""
        parts.append(f"## {label}{cite}\n{section.content.strip()}")
    if report.sources:
        parts.append("=== SOURCES ===")
        for src in report.sources:
            parts.append(f"[{src.id}] {src.title} — {src.url}")
    return "\n\n".join(parts)


def _assemble_prompt(
    context_block: str,
    prior: list[tuple[str, str]],
    user_message: str,
) -> str:
    system = (
        "You are an AI sales research assistant. Answer the user's question using "
        "the briefing below as your source of truth. When you reference a specific "
        "fact, cite the source id inline like [s1]. If the briefing does not cover "
        "the question, say so plainly rather than guessing."
    )
    if not context_block:
        context_block = "(no briefing available — answer from general knowledge and say so)"

    history_lines: list[str] = []
    for role, content in prior:
        speaker = "User" if role == MessageRole.USER.value else "Assistant"
        history_lines.append(f"{speaker}: {content}")
    history = "\n".join(history_lines) if history_lines else "(no prior turns)"

    return (
        f"{system}\n\n"
        f"{context_block}\n\n"
        f"=== CONVERSATION ===\n"
        f"{history}\n"
        f"User: {user_message}\n"
        f"Assistant:"
    )
