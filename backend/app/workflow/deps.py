from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.domain.events import WorkflowEvent
from app.providers.llm.base import LLMProvider
from app.providers.search.base import SearchProvider

EventEmitter = Callable[[WorkflowEvent], Awaitable[None]]


@dataclass
class WorkflowDeps:
    """Runtime dependencies injected into the graph.

    The new graph reads its model from `app.core.config` directly via helpers.
    The search provider is passed via RunnableConfig.configurable["search_provider"]
    so the company_site_search / web_company_search tools can reach it.
    """

    llm: LLMProvider
    search: SearchProvider
    # Optional. When provided, `graph._bind` emits per-node start/complete/failed
    # events. Tests leave it None to keep node tests pure.
    emit: EventEmitter | None = None
