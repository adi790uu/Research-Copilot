"""Provider selection for runtime use.

Returns OpenAI + Tavily when keys are present; otherwise falls back to mocks
so a developer can demo the workflow end-to-end without external API keys.
The fallback shape mirrors `app.workflow.smoke._mock_providers`.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.core.config import Settings
from app.providers.llm.base import LLMProvider
from app.providers.llm.mock import MockLLMProvider
from app.providers.llm.openai import OpenAIProvider
from app.providers.search.base import SearchProvider, SearchResult
from app.providers.search.mock import MockSearchProvider
from app.providers.search.tavily import TavilySearchProvider
from app.workflow.state import QualityCheck, SubQuery


def _mock_providers(company_hint: str = "the target company") -> tuple[LLMProvider, SearchProvider]:
    def search_responder(query: str) -> list[SearchResult]:
        return [
            SearchResult(
                url=f"https://example.com/{abs(hash(query)) % 10000}",
                title=f"Mock page for: {query}",
                snippet=(
                    f"Mock content for '{query}'. {company_hint} builds widgets, "
                    "sells to mid-market customers, raised funding last year, and faces "
                    "competition from larger incumbents."
                ),
            )
        ]

    def llm_factory(prompt: str, schema: type[BaseModel]) -> BaseModel:
        name = schema.__name__
        if "PlannerOutput" in name:
            return schema(
                subqueries=[
                    SubQuery(query=f"{company_hint} overview", section="company_overview"),
                    SubQuery(query=f"{company_hint} products", section="products_and_services"),
                    SubQuery(query=f"{company_hint} customers", section="target_customers"),
                    SubQuery(query=f"{company_hint} funding", section="business_signals"),
                ]
            )
        if "ExtractorOutput" in name:
            return schema(facts=[f"{company_hint} fact A.", f"{company_hint} fact B."])
        if name == "QualityCheck":
            return QualityCheck(passed=True, reasoning="mock — all sections covered")
        raise AssertionError(f"unexpected schema {name}")

    text_responses = [f"Drafted section content #{i}." for i in range(50)]
    return (
        MockLLMProvider(text_responses=text_responses, structured_factory=llm_factory),
        MockSearchProvider(responder=search_responder),
    )


def build_providers(
    settings: Settings, *, company_hint: str = "the target company"
) -> tuple[LLMProvider, SearchProvider]:
    if settings.openai_api_key and settings.tavily_api_key:
        return (
            OpenAIProvider(
                settings.openai_api_key,
                settings.openai_model,
                base_url=settings.openai_base_url or None,
            ),
            TavilySearchProvider(settings.tavily_api_key),
        )
    return _mock_providers(company_hint)
