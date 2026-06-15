"""Researcher subgraph.

Three nodes:
  - researcher       : LLM picks tool calls.
  - researcher_tools : executes tool calls in parallel.
  - compress_research: synthesises raw findings into a citeable summary
                       and extracts Source records via regex.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from typing import Literal, cast

from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
    filter_messages,
)
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from app.core.config import get_settings
from app.domain.report import Source
from app.workflow.helpers import (
    _create_model,
    _get_today_str,
    _is_token_limit_exceeded,
    _remove_up_to_last_ai_message,
    _sanitize_messages_for_llm,
)
from app.workflow.prompts import (
    compress_research_simple_human_message,
    compress_research_system_prompt,
    research_system_prompt,
)
from app.workflow.state import ResearcherState
from app.workflow.tools.research import company_site_search, web_company_search
from app.workflow.tools.think import think_tool

logger = logging.getLogger(__name__)


_TOOL_TIMEOUT_S = 120.0
_TOOL_MAX_RETRIES = 2
_TOOL_BACKOFF = [2, 5]


_SOURCE_PATTERN = re.compile(
    r"--- SOURCE \d+: (.+?) ---\nURL: (\S+)\nType: (\w+)\n",
    re.MULTILINE,
)


def _source_id_for(url: str) -> str:
    return f"src_{hashlib.sha1(url.encode()).hexdigest()[:8]}"


def _extract_sources_from_messages(messages: list) -> list[Source]:
    sources: list[Source] = []
    seen: set[str] = set()
    for msg in filter_messages(messages, include_types=["tool"]):
        content = msg.content if isinstance(msg.content, str) else ""
        for title, url, _stype in _SOURCE_PATTERN.findall(content):
            if url in seen:
                continue
            seen.add(url)
            sources.append(
                Source(
                    id=_source_id_for(url),
                    url=url.strip(),
                    title=title.strip(),
                    snippet=None,
                )
            )
    return sources


def _select_tools(tools_to_use: str) -> list:
    if tools_to_use == "company_site":
        return [company_site_search, think_tool]
    if tools_to_use == "web":
        return [web_company_search, think_tool]
    return [company_site_search, web_company_search, think_tool]


def _render_tools_section(tools: list) -> tuple[str, str]:
    descriptions = []
    names = []
    for i, t in enumerate(tools, 1):
        names.append(t.name)
        if t.name == "company_site_search":
            descriptions.append(f"{i}. company_site_search: scrape the company's own website (about, products, blog, pricing).")
        elif t.name == "web_company_search":
            descriptions.append(f"{i}. web_company_search: external sources (news, funding, reviews). Company name is prepended automatically.")
        elif t.name == "think_tool":
            descriptions.append(f"{i}. think_tool: short reflection on findings or next steps. Do not call in parallel with other tools.")
    section = "\n".join(descriptions)
    if "company_site_search" in names and "web_company_search" in names:
        routing = "Use BOTH company_site_search and web_company_search. Start on the company site for grounding, then go external for signals."
    elif "company_site_search" in names:
        routing = "Use company_site_search for every query. Stay on the company's own pages."
    else:
        routing = "Use web_company_search for every query. The company name is anchored automatically."
    return section, routing


async def researcher(
    state: ResearcherState, config: RunnableConfig
) -> Command[Literal["researcher_tools"]]:
    tools_to_use = state.get("tools_to_use", "both")
    tools = _select_tools(tools_to_use)
    tools_section, tool_routing = _render_tools_section(tools)

    model = (
        _create_model(temperature=0.0)
        .bind_tools(tools)
        .with_retry(stop_after_attempt=2)
    )

    prompt = research_system_prompt.format(
        company_name=state.get("company_name", ""),
        website=state.get("website", ""),
        research_topic=state.get("research_topic", ""),
        section=state.get("section", "company_overview"),
        tools_section=tools_section,
        tool_routing=tool_routing,
        date=_get_today_str(),
    )

    messages = [SystemMessage(content=prompt)] + list(state.get("researcher_messages", []))
    messages = _sanitize_messages_for_llm(messages)

    response = await model.ainvoke(messages)

    return Command(
        goto="researcher_tools",
        update={
            "researcher_messages": [response],
            "tool_call_iterations": state.get("tool_call_iterations", 0) + 1,
        },
    )


async def _execute_tool_safely(t, args, config):
    last_error: Exception | None = None
    for attempt in range(_TOOL_MAX_RETRIES):
        try:
            return await asyncio.wait_for(t.ainvoke(args, config), timeout=_TOOL_TIMEOUT_S)
        except TimeoutError:
            last_error = TimeoutError(f"Tool '{t.name}' timed out after {_TOOL_TIMEOUT_S}s")
            logger.warning("tool %s timeout attempt %d", t.name, attempt + 1)
        except Exception as e:  # noqa: BLE001
            last_error = e
            error_str = str(e).lower()
            if any(kw in error_str for kw in ("validation", "invalid", "missing required")):
                return f"Error executing tool: {e}"
            logger.warning("tool %s failed attempt %d: %s", t.name, attempt + 1, e)
        if attempt < _TOOL_MAX_RETRIES - 1:
            await asyncio.sleep(_TOOL_BACKOFF[attempt])
    return f"Error executing tool after {_TOOL_MAX_RETRIES} attempts: {last_error}"


async def researcher_tools(
    state: ResearcherState, config: RunnableConfig
) -> Command[Literal["researcher", "compress_research"]]:
    settings = get_settings()
    max_tool_calls = settings.workflow_max_react_tool_calls

    researcher_messages = list(state.get("researcher_messages", []))
    most_recent = cast(AIMessage, researcher_messages[-1])
    tool_calls = most_recent.tool_calls or []

    if not tool_calls:
        return Command(goto="compress_research")

    tools = _select_tools(state.get("tools_to_use", "both"))
    tools_by_name = {t.name: t for t in tools}

    valid_calls = [tc for tc in tool_calls if tc["name"] in tools_by_name]
    observations = await asyncio.gather(
        *[
            _execute_tool_safely(tools_by_name[tc["name"]], tc["args"], config)
            for tc in valid_calls
        ]
    )

    tool_outputs: list[ToolMessage] = []
    for obs, tc in zip(observations, valid_calls):
        if isinstance(obs, ToolMessage):
            obs.tool_call_id = tc["id"]
            tool_outputs.append(obs)
        else:
            tool_outputs.append(
                ToolMessage(
                    content=str(obs) if obs else "No results found.",
                    name=tc["name"],
                    tool_call_id=tc["id"],
                )
            )

    # Error-back any tool calls the LLM made for tools we filtered out.
    for tc in tool_calls:
        if tc["name"] not in tools_by_name:
            tool_outputs.append(
                ToolMessage(
                    content=(
                        f"Tool '{tc['name']}' is not available. "
                        f"Use one of: {', '.join(tools_by_name.keys())}."
                    ),
                    name=tc["name"],
                    tool_call_id=tc["id"],
                )
            )

    exceeded = state.get("tool_call_iterations", 0) >= max_tool_calls
    if exceeded:
        return Command(goto="compress_research", update={"researcher_messages": tool_outputs})

    return Command(goto="researcher", update={"researcher_messages": tool_outputs})


async def compress_research(state: ResearcherState, config: RunnableConfig) -> dict:
    company_name = state.get("company_name", "")
    model = _create_model(temperature=0.0)

    researcher_messages = list(state.get("researcher_messages", []))
    researcher_messages.append(
        HumanMessage(content=compress_research_simple_human_message.format(company_name=company_name))
    )

    sources = _extract_sources_from_messages(researcher_messages)

    attempts = 0
    while attempts < 3:
        try:
            system = compress_research_system_prompt.format(
                company_name=company_name, date=_get_today_str()
            )
            messages = [SystemMessage(content=system)] + researcher_messages
            messages = _sanitize_messages_for_llm(messages)

            response = await model.ainvoke(messages)
            raw_notes = "\n".join(
                str(m.content)
                for m in filter_messages(researcher_messages, include_types=["tool", "ai"])
            )
            return {
                "compressed_research": str(response.content),
                "raw_notes": [raw_notes],
                "sources": sources,
            }
        except Exception as e:  # noqa: BLE001
            attempts += 1
            if _is_token_limit_exceeded(e):
                researcher_messages = _remove_up_to_last_ai_message(researcher_messages)
                continue
            logger.exception("compress_research failed")
            break

    raw_notes = "\n".join(
        str(m.content)
        for m in filter_messages(researcher_messages, include_types=["tool", "ai"])
    )
    return {
        "compressed_research": "Error compressing research findings (max retries exceeded).",
        "raw_notes": [raw_notes],
        "sources": sources,
    }


def get_researcher_subgraph():
    """Return a fresh researcher subgraph per invocation.

    Must NOT be a singleton — parallel researchers would share state otherwise.
    """
    builder = StateGraph(ResearcherState)
    builder.add_node("researcher", researcher)
    builder.add_node("researcher_tools", researcher_tools)
    builder.add_node("compress_research", compress_research)
    builder.add_edge(START, "researcher")
    builder.add_edge("compress_research", END)
    return builder.compile()
