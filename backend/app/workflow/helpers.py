"""Shared utilities for the company-research workflow (Graph 1).

Builds the chat model from config and handles the GPT-5 / o-series quirks
around sampling parameters.
"""

from __future__ import annotations

from datetime import datetime

from langchain_openai import ChatOpenAI

from app.core.config import get_settings

# Model families that reject non-default sampling parameters (`temperature`,
# `top_p`, etc.) — currently GPT-5 and the o-series reasoning models. The
# API returns a 400 with "Unsupported value: 'temperature' does not support
# X with this model" if we send temperature on these.
#
# We compare against the bare model id (after any `org/` prefix the
# GitHub-Models endpoint adds), so `openai/gpt-5-mini` is matched.
_NO_TEMPERATURE_PREFIXES: tuple[str, ...] = (
    "gpt-5",
    "o1",
    "o3",
    "o4",
)

# Same families also accept a `reasoning_effort` knob ("minimal" | "low" |
# "medium" | "high"). We force "minimal" by default so every LLM hop stays
# fast — the GPT-5 series' built-in chain-of-thought burns 2-10x more tokens.
_REASONING_PREFIXES: tuple[str, ...] = _NO_TEMPERATURE_PREFIXES


def _bare_model_id(model_name: str) -> str:
    """Strip an optional `org/` prefix (e.g. `openai/gpt-5` → `gpt-5`)."""
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
    """Build a ChatOpenAI from config.

    `model_name` defaults to settings.openai_model. `max_tokens` is the
    max_completion_tokens hint; None lets the SDK choose.
    """
    settings = get_settings()
    resolved_model = model_name or settings.openai_model
    kwargs: dict = {
        "model": resolved_model,
        "api_key": settings.openai_api_key or "sk-missing",
    }
    # GPT-5 / o-series only accept the default temperature — sending one
    # produces a 400. Drop it for those families; pass through otherwise.
    if _model_accepts_temperature(resolved_model):
        kwargs["temperature"] = temperature
    if _model_takes_reasoning_effort(resolved_model):
        kwargs["reasoning_effort"] = "minimal"
    if settings.openai_base_url:
        kwargs["base_url"] = settings.openai_base_url
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    return ChatOpenAI(**kwargs)
