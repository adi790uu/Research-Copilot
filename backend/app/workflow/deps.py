from dataclasses import dataclass

from app.providers.llm.base import LLMProvider
from app.providers.search.base import SearchProvider


@dataclass
class WorkflowDeps:
    llm: LLMProvider
    search: SearchProvider
    search_results_per_query: int = 5
