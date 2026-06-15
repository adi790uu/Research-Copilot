"""Unit tests for the company-research workflow nodes.

Strategy: patch `app.workflow.helpers._create_model` per node so we control
exactly what the LLM returns. The model is small and self-contained — it
mirrors only the methods each node actually calls (with_structured_output,
bind_tools, with_retry, ainvoke).
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.workflow.nodes import clarify, research_brief, research_plan
from app.workflow.nodes.supervisor import supervisor, supervisor_tools
from app.workflow.state import (
    ClarificationQuestion,
    ClarifyWithUser,
    ResearchBrief,
    ResearchPlan,
    ResearchSubtopic,
)

# ----- Fake model -----------------------------------------------------------

class _FakeModel:
    """Minimal stand-in for `_create_model(...)` return value.

    `responder(messages, *, mode)` returns whatever the wrapped node wants:
      - mode="structured" => a pydantic instance
      - mode="bound"      => an AIMessage (with optional tool_calls)
      - mode="raw"        => an AIMessage with string content
    """

    def __init__(
        self,
        responder: Callable[[Any, str], Awaitable[Any] | Any] | None = None,
        *,
        mode: str = "raw",
    ) -> None:
        self._responder = responder
        self._mode = mode

    def with_structured_output(self, schema: type[Any]) -> _FakeModel:
        clone = _FakeModel(self._responder, mode="structured")
        clone._schema = schema  # type: ignore[attr-defined]
        return clone

    def bind_tools(self, _tools: list[Any]) -> _FakeModel:
        return _FakeModel(self._responder, mode="bound")

    def with_retry(self, **_kwargs: Any) -> _FakeModel:
        return self

    async def ainvoke(self, messages: Any, *_args: Any, **_kwargs: Any) -> Any:
        if self._responder is None:
            if self._mode == "raw":
                return AIMessage(content="")
            return None
        result = self._responder(messages, self._mode)
        if hasattr(result, "__await__"):
            result = await result  # type: ignore[func-returns-value]
        return result


# ----- clarify_with_user ----------------------------------------------------


async def test_clarify_skipped_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        clarify, "_create_model", lambda **_: _FakeModel(),
    )
    cmd = await clarify.clarify_with_user(
        {"company_name": "Acme", "website": "https://acme.example.com", "objective": "x", "messages": []},
        {"configurable": {"allow_clarification": False}},
    )
    assert cmd.goto == "write_research_brief"


async def test_clarify_routes_to_brief_when_no_clarification_needed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def responder(_messages: Any, mode: str) -> ClarifyWithUser:
        assert mode == "structured"
        return ClarifyWithUser(need_clarification=False, questions=[])

    monkeypatch.setattr(clarify, "_create_model", lambda **_: _FakeModel(responder))
    cmd = await clarify.clarify_with_user(
        {"company_name": "Acme", "website": "https://acme.example.com", "objective": "x", "messages": []},
        {"configurable": {"allow_clarification": True}},
    )
    assert cmd.goto == "write_research_brief"


async def test_clarify_terminates_with_question_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    questions = [ClarificationQuestion(question="Which Acme?", suggested_answers=["a", "b"])]

    def responder(_messages: Any, mode: str) -> ClarifyWithUser:
        return ClarifyWithUser(need_clarification=True, questions=questions)

    monkeypatch.setattr(clarify, "_create_model", lambda **_: _FakeModel(responder))
    cmd = await clarify.clarify_with_user(
        {"company_name": "Acme", "website": "https://acme.example.com", "objective": "x", "messages": []},
        {"configurable": {"allow_clarification": True}},
    )
    from langgraph.graph import END

    assert cmd.goto == END
    payload = json.loads(cmd.update["messages"][0].content)
    assert payload["type"] == "clarification"
    assert payload["questions"][0]["question"] == "Which Acme?"


# ----- write_research_brief -------------------------------------------------


async def test_research_brief_emits_supervisor_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    brief = ResearchBrief(
        research_goal="Evaluate Acme as a partner.",
        key_entities=["Acme"],
        constraints=[],
        source_strategy="company_site_first",
    )

    def responder(_messages: Any, _mode: str) -> ResearchBrief:
        return brief

    monkeypatch.setattr(
        research_brief, "_create_model", lambda **_: _FakeModel(responder)
    )

    cmd = await research_brief.write_research_brief(
        {
            "company_name": "Acme",
            "website": "https://acme.example.com",
            "objective": "Eval",
            "messages": [HumanMessage(content="seed")],
        },
        {},
    )
    assert cmd.goto == "create_research_plan"
    assert "Acme" in cmd.update["research_brief"]
    supervisor_seed = cmd.update["supervisor_messages"]
    assert supervisor_seed["type"] == "override"
    # System message + brief HumanMessage.
    assert len(supervisor_seed["value"]) == 2


# ----- create_research_plan -------------------------------------------------


async def test_research_plan_emits_plan_ready_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    plan = ResearchPlan(
        user_message="I'll research Acme overview and signals.",
        strategy_summary="Start with company site, then external news.",
        subtopics=[
            ResearchSubtopic(
                title="Overview",
                description="Who they are.",
                section="company_overview",
                tools="company_site",
                priority="depth",
            ),
            ResearchSubtopic(
                title="Funding",
                description="Recent rounds.",
                section="business_signals",
                tools="web",
                priority="depth",
            ),
        ],
    )

    monkeypatch.setattr(
        research_plan, "_create_model", lambda **_: _FakeModel(lambda *_: plan)
    )

    result = await research_plan.create_research_plan(
        {"company_name": "Acme", "website": "https://acme.example.com", "research_brief": "brief"},
        {},
    )
    # research_plan is stored as a plain dict (not the Pydantic model) so the
    # langgraph checkpointer doesn't have to round-trip an app-defined type.
    assert isinstance(result["research_plan"], dict)
    assert result["research_plan"]["subtopics"][0]["section"] == "company_overview"
    assert result["messages"][0].additional_kwargs.get("plan_ready") is True


# ----- supervisor / supervisor_tools ----------------------------------------


async def test_supervisor_tools_routes_to_end_on_research_complete() -> None:
    ai = AIMessage(
        content="",
        tool_calls=[
            {"id": "tc1", "name": "ResearchComplete", "args": {}},
        ],
    )
    state = {"supervisor_messages": [ai], "research_iterations": 0, "research_brief": "b"}
    cmd = await supervisor_tools(state, {})
    from langgraph.graph import END

    assert cmd.goto == END


async def test_supervisor_tools_records_think_reflection() -> None:
    ai = AIMessage(
        content="",
        tool_calls=[
            {
                "id": "tc_think",
                "name": "think_tool",
                "args": {"reflection": "need more on funding"},
            },
        ],
    )
    state = {"supervisor_messages": [ai], "research_iterations": 0}
    cmd = await supervisor_tools(state, {})
    out = cmd.update["supervisor_messages"]
    assert any(isinstance(m, ToolMessage) and "need more on funding" in m.content for m in out)
    assert cmd.goto == "supervisor"


async def test_supervisor_invokes_chat_model(monkeypatch: pytest.MonkeyPatch) -> None:
    ai_response = AIMessage(content="", tool_calls=[])

    def responder(_messages: Any, mode: str) -> Any:
        assert mode == "bound"
        return ai_response

    from app.workflow.nodes import supervisor as supervisor_mod

    monkeypatch.setattr(supervisor_mod, "_create_model", lambda **_: _FakeModel(responder))

    state = {"supervisor_messages": [HumanMessage(content="x")], "research_iterations": 0}
    cmd = await supervisor(state, {})
    assert cmd.goto == "supervisor_tools"
    assert cmd.update["research_iterations"] == 1
