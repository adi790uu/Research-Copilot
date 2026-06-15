from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.domain.events import WorkflowEvent
from app.providers.llm.base import LLMProvider
from app.providers.search.base import SearchProvider

EventEmitter = Callable[[WorkflowEvent], Awaitable[None]]


@dataclass
class WorkflowDeps:
    llm: LLMProvider
    search: SearchProvider
    search_results_per_query: int = 5
    # Optional. When provided, `graph._bind` emits per-node start/complete/failed
    # events. Tests leave it None to keep node tests pure.
    emit: EventEmitter | None = None
