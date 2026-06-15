"""Tests for the researcher subgraph helpers and the company-research tools."""

from __future__ import annotations

from langchain_core.messages import ToolMessage

from app.providers.search.base import ExtractedPage, SearchResult
from app.providers.search.mock import MockSearchProvider
from app.workflow.nodes.researcher import _extract_sources_from_messages, _select_tools
from app.workflow.tools.research import company_site_search, web_company_search

# ----- source extraction regex ---------------------------------------------


def test_extract_sources_dedupes_by_url_and_assigns_stable_ids() -> None:
    tm = ToolMessage(
        name="company_site_search",
        tool_call_id="tc_1",
        content=(
            "--- SOURCE 1: About Page ---\n"
            "URL: https://acme.example.com/about\n"
            "Type: company_site\n\n"
            "CONTENT:\nWe build widgets.\n\n"
            "----\n"
            "--- SOURCE 2: About Page ---\n"
            "URL: https://acme.example.com/about\n"   # duplicate -> deduped
            "Type: company_site\n\n"
            "CONTENT:\nrepeat\n\n"
            "----\n"
            "--- SOURCE 3: TechCrunch Coverage ---\n"
            "URL: https://techcrunch.com/acme\n"
            "Type: web\n\n"
            "CONTENT:\nThey raised $20M.\n\n"
        ),
    )
    sources = _extract_sources_from_messages([tm])
    assert [s.url for s in sources] == [
        "https://acme.example.com/about",
        "https://techcrunch.com/acme",
    ]
    # Stable ID derived from the URL (sha1 first 8 chars), prefixed src_.
    for s in sources:
        assert s.id.startswith("src_") and len(s.id) == 12


# ----- tool selection -------------------------------------------------------


def test_select_tools_company_site_only() -> None:
    names = {t.name for t in _select_tools("company_site")}
    assert names == {"company_site_search", "think_tool"}


def test_select_tools_web_only() -> None:
    names = {t.name for t in _select_tools("web")}
    assert names == {"web_company_search", "think_tool"}


def test_select_tools_both() -> None:
    names = {t.name for t in _select_tools("both")}
    assert names == {"company_site_search", "web_company_search", "think_tool"}


# ----- company_site_search tool --------------------------------------------


async def test_company_site_search_restricts_to_company_domain() -> None:
    captured: list[tuple[str, list[str] | None]] = []

    def responder(q: str) -> list[SearchResult]:
        return [
            SearchResult(
                url=f"https://acme.example.com/{abs(hash(q)) % 1000}",
                title="About",
                snippet="About Acme",
                content="Acme makes widgets.",
            )
        ]

    class _Capturing(MockSearchProvider):
        async def search(self, query, *, max_results=5, include_domains=None, **kwargs):  # type: ignore[override]
            captured.append((query, list(include_domains) if include_domains else None))
            return await super().search(
                query, max_results=max_results, include_domains=include_domains, **kwargs
            )

    provider = _Capturing(responder=responder)
    config = {
        "configurable": {
            "search_provider": provider,
            "website": "https://acme.example.com",
            "company_name": "Acme",
        }
    }
    out = await company_site_search.ainvoke({"queries": ["overview"], "max_results": 2}, config=config)
    assert "--- SOURCE" in out
    assert captured[0][1] == ["acme.example.com"]  # domain extracted from website
    # Map + extract path was triggered too — mock provider returns "extract content for ..."
    assert "Mock extracted content" in out or "Acme makes widgets" in out


async def test_company_site_search_errors_without_website() -> None:
    out = await company_site_search.ainvoke(
        {"queries": ["x"]},
        config={"configurable": {"search_provider": MockSearchProvider()}},
    )
    assert out.startswith("Error: company_site_search is not configured")


# ----- web_company_search tool ---------------------------------------------


async def test_web_company_search_prepends_company_name() -> None:
    captured: list[str] = []

    def responder(q: str) -> list[SearchResult]:
        return [
            SearchResult(
                url=f"https://techcrunch.com/{abs(hash(q)) % 1000}",
                title="News",
                snippet="snip",
                content="News content.",
            )
        ]

    class _Capturing(MockSearchProvider):
        async def search(self, query, **kwargs):  # type: ignore[override]
            captured.append(query)
            return await super().search(query, **kwargs)

    provider = _Capturing(responder=responder)
    config = {
        "configurable": {
            "search_provider": provider,
            "company_name": "Acme",
            "website": "https://acme.example.com",
        }
    }
    out = await web_company_search.ainvoke(
        {"queries": ["funding", "hiring"], "topic": "news"},
        config=config,
    )
    assert "--- SOURCE" in out
    assert captured == ["Acme funding", "Acme hiring"]


# ----- mock provider extract/map sanity ------------------------------------


async def test_mock_provider_extract_and_map_defaults() -> None:
    provider = MockSearchProvider()
    extracted = await provider.extract(["https://acme.example.com"])
    assert len(extracted) == 1
    assert isinstance(extracted[0], ExtractedPage)
    mapped = await provider.map("https://acme.example.com")
    assert [m.title for m in mapped] == ["About", "Pricing", "Blog"]
