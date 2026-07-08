from __future__ import annotations

from langgraph.graph import MessagesState

HISTORY_TURN_CAP = 8


class CopilotState(MessagesState):
    """Chat state for the Copilot graph. Just the running message list — the
    per-turn grounding prompt rides in via `config["configurable"]`, not state,
    so it is never persisted into the thread checkpoint."""


__all__ = ["CopilotState", "HISTORY_TURN_CAP"]
