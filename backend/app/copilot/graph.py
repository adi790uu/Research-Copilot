from __future__ import annotations

from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import START, StateGraph

from app.copilot.nodes.chat import chat
from app.copilot.state import CopilotState


def build_graph(*, checkpointer: BaseCheckpointSaver | None = None) -> Any:

    builder: StateGraph = StateGraph(CopilotState)
    builder.add_node("chat", chat)
    builder.add_edge(START, "chat")
    return builder.compile(checkpointer=checkpointer)
