from __future__ import annotations

from typing import Any

from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI

from app.copilot.state import HISTORY_TURN_CAP, CopilotState
from app.workflow.helpers import _create_model

_chat_model: ChatOpenAI | None = None


def _get_chat_model() -> ChatOpenAI:
    global _chat_model
    if _chat_model is None:
        _chat_model = _create_model(temperature=0.3)
    return _chat_model


async def chat(state: CopilotState, config: RunnableConfig) -> dict[str, Any]:
    system_prompt = (config.get("configurable") or {}).get("system_prompt", "")
    model = _get_chat_model()
    history = state["messages"][-HISTORY_TURN_CAP:]
    resp = await model.ainvoke([SystemMessage(content=system_prompt), *history])

    return {"messages": [resp]}
