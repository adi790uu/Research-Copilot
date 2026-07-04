from __future__ import annotations

from datetime import datetime

from langchain_openai import ChatOpenAI

from app.core.config import get_settings

_NO_TEMPERATURE_PREFIXES: tuple[str, ...] = (
    "gpt-5",
    "o1",
    "o3",
    "o4",
)

_REASONING_PREFIXES: tuple[str, ...] = _NO_TEMPERATURE_PREFIXES


def _bare_model_id(model_name: str) -> str:
    return model_name.rsplit("/", 1)[-1]


def _model_accepts_temperature(model_name: str) -> bool:
    bare = _bare_model_id(model_name)
    return not any(bare.startswith(p) for p in _NO_TEMPERATURE_PREFIXES)


def _model_takes_reasoning_effort(model_name: str) -> bool:
    bare = _bare_model_id(model_name)
    return any(bare.startswith(p) for p in _REASONING_PREFIXES)


def _get_today_str() -> str:
    now = datetime.now()
    return f"{now:%a} {now:%b} {now.day}, {now:%Y}"


def _create_model(
    *,
    model_name: str | None = None,
    max_tokens: int | None = None,
    temperature: float = 0.2,
) -> ChatOpenAI:
    settings = get_settings()
    resolved_model = model_name or settings.openai_model
    kwargs: dict = {
        "model": resolved_model,
        "api_key": settings.openai_api_key or "sk-missing",
    }
    if _model_accepts_temperature(resolved_model):
        kwargs["temperature"] = temperature
    if _model_takes_reasoning_effort(resolved_model):
        kwargs["reasoning_effort"] = "minimal"
    if settings.openai_base_url:
        kwargs["base_url"] = settings.openai_base_url
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    return ChatOpenAI(**kwargs)
