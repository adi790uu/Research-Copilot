"""Provider selection for runtime use.

Returns OpenAI + Tavily when keys are present; otherwise falls back to mocks
so a developer can demo the workflow end-to-end without external API keys.
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
                content=(
                    f"Detailed mock body about {company_hint}. They were founded in 2018, "
                    "raised a $20M Series A in 2024, and primarily serve mid-market SaaS companies."
                ),
            )
        ]

    def llm_factory(prompt: str, schema: type[BaseModel]) -> BaseModel:
        # Provide a permissive factory — the deep_research nodes call
        # with_structured_output on LangChain directly, but this factory is kept
        # for any LLMProvider.structured() callers (e.g. smoke / legacy tests).
        try:
            return schema()  # type: ignore[call-arg]
        except Exception:  # noqa: BLE001
            return schema.model_construct()

    text_responses = [f"Drafted content #{i}." for i in range(50)]
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
