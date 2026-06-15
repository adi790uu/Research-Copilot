"""Clarification gate node.

Decides whether the user's objective is too ambiguous to research without
follow-up. When clarification is needed, the graph terminates at END with a
JSON payload on the last AIMessage; the service layer translates that into a
ClarificationRequested SSE event.
"""

from __future__ import annotations

import json
import logging
from typing import cast

from langchain_core.messages import AIMessage, HumanMessage, get_buffer_string
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END
from langgraph.types import Command

from app.core.config import get_settings
from app.workflow.helpers import _create_model, _get_today_str
from app.workflow.prompts import clarify_with_user_instructions
from app.workflow.state import AgentState, ClarifyWithUser

logger = logging.getLogger(__name__)


async def clarify_with_user(state: AgentState, config: RunnableConfig) -> Command:
    configurable = (config or {}).get("configurable", {}) or {}
    allow_clarification = configurable.get(
        "allow_clarification", get_settings().workflow_allow_clarification
    )

    if not allow_clarification:
        return Command(goto="write_research_brief")

    model = _create_model(temperature=0.0).with_structured_output(ClarifyWithUser).with_retry(
        stop_after_attempt=3
    )

    prompt = clarify_with_user_instructions.format(
        company_name=state.get("company_name", ""),
        website=state.get("website", ""),
        objective=state.get("objective", ""),
        messages=get_buffer_string(state.get("messages", [])),
        date=_get_today_str(),
    )

    response = cast(ClarifyWithUser, await model.ainvoke([HumanMessage(content=prompt)]))

    if not response.need_clarification:
        return Command(goto="write_research_brief")

    payload = json.dumps(
        {
            "type": "clarification",
            "questions": [
                {"question": q.question, "suggested_answers": q.suggested_answers}
                for q in response.questions
            ],
        }
    )
    return Command(
        goto=END,
        update={"messages": [AIMessage(content=payload)]},
    )
