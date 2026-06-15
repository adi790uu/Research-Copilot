"""Shared utilities for the deep-research workflow.

Ported from research-assistant/deep_research/helpers.py and trimmed to what
research-copilot actually needs (no Milvus, no OpenAI-native web search).
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    SystemMessage,
    ToolMessage,
    filter_messages,
)
from langchain_openai import ChatOpenAI

from app.core.config import get_settings
from app.workflow.key_rotation import get_rotator

logger = logging.getLogger(__name__)

try:
    from openai import RateLimitError as _OpenAIRateLimitError
except Exception:  # pragma: no cover — defensive
    _OpenAIRateLimitError = None  # type: ignore[assignment]


def _is_rate_limit(exc: BaseException) -> bool:
    if _OpenAIRateLimitError is not None and isinstance(exc, _OpenAIRateLimitError):
        return True
    if exc.__class__.__name__ == "RateLimitError":
        return True
    status = getattr(exc, "status_code", None) or getattr(exc, "http_status", None)
    return status == 429


# Per-model context-window ceilings, used by token-limit recovery in
# final_report. Keep in sync with what we actually deploy.
MODEL_TOKEN_LIMITS: dict[str, int] = {
    "gpt-4.1-mini": 1_047_576,
    "gpt-4.1-nano": 1_047_576,
    "gpt-4.1": 1_047_576,
    "gpt-4o-mini": 128_000,
    "gpt-4o": 128_000,
    "o4-mini": 200_000,
    "o3-mini": 200_000,
}


def _get_today_str() -> str:
    now = datetime.now()
    return f"{now:%a} {now:%b} {now.day}, {now:%Y}"


def _get_notes_from_tool_calls(messages: list[BaseMessage]) -> list[str]:
    return [str(m.content) for m in filter_messages(messages, include_types="tool")]


def _is_token_limit_exceeded(exception: Exception) -> bool:
    error_str = str(exception).lower()
    class_name = exception.__class__.__name__
    module_name = getattr(exception.__class__, "__module__", "") or ""

    is_openai = "openai" in module_name.lower() or "openai" in str(type(exception)).lower()
    is_request_error = class_name in {"BadRequestError", "InvalidRequestError"}
    if is_openai and is_request_error and any(
        kw in error_str for kw in ("token", "context", "length", "maximum context", "reduce")
    ):
        return True

    code = getattr(exception, "code", "")
    etype = getattr(exception, "type", "")
    return code == "context_length_exceeded" or etype == "invalid_request_error"


def _get_model_token_limit(model_name: str) -> int | None:
    for key, limit in MODEL_TOKEN_LIMITS.items():
        if key in model_name:
            return limit
    return None


def _remove_up_to_last_ai_message(messages: list[BaseMessage]) -> list[BaseMessage]:
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], AIMessage):
            return messages[:i]
    return messages


def _sanitize_messages_for_llm(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Drop orphan ToolMessages so OpenAI's strict ordering rules don't reject the batch.

    Rules enforced:
    - A ToolMessage must be preceded by an AIMessage that has tool_calls.
    - SystemMessages pass through.
    """
    sanitized: list[BaseMessage] = []
    last_ai_had_tool_calls = False
    for msg in messages:
        if isinstance(msg, SystemMessage):
            sanitized.append(msg)
            continue
        if isinstance(msg, AIMessage):
            last_ai_had_tool_calls = bool(getattr(msg, "tool_calls", None))
            sanitized.append(msg)
            continue
        if isinstance(msg, ToolMessage):
            if last_ai_had_tool_calls:
                sanitized.append(msg)
            continue
        last_ai_had_tool_calls = False
        sanitized.append(msg)
    return sanitized


class _RotatingModel:
    """Chat-model wrapper that picks a fresh API key per `ainvoke`.

    Records each `bind_tools` / `with_structured_output` / `with_retry` call as
    a deferred operation. On every `ainvoke` we acquire the next key from the
    rotator, instantiate `ChatOpenAI` with that key, replay the chain, then
    call its `ainvoke`. On `RateLimitError` we cool the key and retry with the
    next one (bounded by the pool size).

    When the rotator is None (single-key setup) we still build a fresh model
    each call — but only one key exists so this degrades cleanly.
    """

    _PROXY_ATTRS = {"with_config", "with_listeners", "with_alisteners", "with_types"}

    def __init__(
        self,
        *,
        base_kwargs: dict[str, Any],
        chain: list[tuple[str, tuple[Any, ...], dict[str, Any]]] | None = None,
    ) -> None:
        self._base_kwargs = base_kwargs
        self._chain = list(chain or [])

    # ---- chain recording -------------------------------------------------

    def _clone_with(self, method: str, *args: Any, **kwargs: Any) -> _RotatingModel:
        return _RotatingModel(
            base_kwargs=self._base_kwargs,
            chain=self._chain + [(method, args, kwargs)],
        )

    def bind_tools(self, *args: Any, **kwargs: Any) -> _RotatingModel:
        return self._clone_with("bind_tools", *args, **kwargs)

    def with_structured_output(self, *args: Any, **kwargs: Any) -> _RotatingModel:
        return self._clone_with("with_structured_output", *args, **kwargs)

    def with_retry(self, *args: Any, **kwargs: Any) -> _RotatingModel:
        # We deliberately drop with_retry from the replay chain: our own
        # rotation-aware retry below handles 429s, and re-trying on the same
        # rate-limited key adds latency without help. Other error classes
        # bubble up immediately so callers can react.
        return self

    # ---- build + invoke --------------------------------------------------

    def _build(self, api_key: str) -> Any:
        kwargs = dict(self._base_kwargs, api_key=api_key)
        model: Any = ChatOpenAI(**kwargs)
        for method, args, kw in self._chain:
            model = getattr(model, method)(*args, **kw)
        return model

    async def ainvoke(self, messages: Any, *args: Any, **kwargs: Any) -> Any:
        rotator = get_rotator()
        model_name = self._base_kwargs.get("model", "?")
        max_attempts = rotator.size if rotator else 1
        # Cap to keep a degenerate "everything 429s" run from melting the loop.
        max_attempts = min(max_attempts, 8)

        last_exc: BaseException | None = None
        for attempt in range(max_attempts):
            if rotator is not None:
                lease = await rotator.acquire()
                api_key = lease.key
            else:
                lease = None
                api_key = (
                    self._base_kwargs.get("api_key")
                    or get_settings().openai_api_key
                    or "sk-missing"
                )
            try:
                model = self._build(api_key)
                return await model.ainvoke(messages, *args, **kwargs)
            except Exception as exc:
                if lease is not None and _is_rate_limit(exc):
                    logger.warning(
                        "rate limit on key %s (attempt %d/%d) — rotating",
                        lease.short_id, attempt + 1, max_attempts,
                    )
                    await rotator.cool_down(lease)  # type: ignore[union-attr]
                    last_exc = exc
                    continue
                # Non-rate-limit failures: log context and re-raise.
                logger.error("LLM call failed [model=%s]: %s", model_name, str(exc)[:500])
                if isinstance(messages, list):
                    for i, m in enumerate(messages[:10]):
                        content = getattr(m, "content", "")
                        clen = len(content) if isinstance(content, str) else len(str(content))
                        logger.error("  msg[%d] %s len=%d", i, type(m).__name__, clen)
                raise

        # Exhausted the pool without success.
        assert last_exc is not None  # for type-checker
        raise last_exc


def _create_model(
    *,
    model_name: str | None = None,
    max_tokens: int | None = None,
    temperature: float = 0.2,
) -> _RotatingModel:
    """Build a chat-model wrapper that round-robins API keys per ainvoke.

    `model_name` defaults to settings.openai_model. `max_tokens` is the
    max_completion_tokens hint; None lets the SDK choose. The actual API key
    is selected at call time by `_RotatingModel.ainvoke`.
    """
    settings = get_settings()
    base_kwargs: dict[str, Any] = {
        "model": model_name or settings.openai_model,
        "temperature": temperature,
    }
    if settings.openai_base_url:
        base_kwargs["base_url"] = settings.openai_base_url
    if max_tokens is not None:
        base_kwargs["max_tokens"] = max_tokens
    return _RotatingModel(base_kwargs=base_kwargs)
