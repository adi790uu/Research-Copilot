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


def _already_clarified(messages: list) -> bool:
    seen = False
    for m in messages:
        if isinstance(m, AIMessage) and '"type": "clarification"' in str(m.content):
            seen = True
        elif seen and isinstance(m, HumanMessage):
            return True
    return False


async def clarify_with_user(state: AgentState, config: RunnableConfig) -> Command:
    configurable = (config or {}).get("configurable", {}) or {}
    allow_clarification = configurable.get(
        "allow_clarification", get_settings().workflow_allow_clarification
    )

    if not allow_clarification:
        return Command(goto="write_research_brief")

    # Hard single-round limit, enforced in code rather than left to the model.
    if _already_clarified(state.get("messages", [])):
        return Command(goto="write_research_brief")

    model = _create_model(temperature=0.0).with_structured_output(ClarifyWithUser).with_retry(
        stop_after_attempt=3
    )

    prompt = clarify_with_user_instructions.format(
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
