"""Tavily-backed research tools for the company-research workflow.

Two tools the researcher binds:
  - company_site_search: anchored to the company's own domain (map + extract + search).
  - web_company_search: external search, with the company name prepended to every query.

Both return formatted `--- SOURCE N: ... ---` blocks so compress_research's
regex can extract sources without further parsing.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Annotated, Literal
from urllib.parse import urlparse

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolArg, tool

from app.providers.search.base import ExtractedPage, MappedUrl, SearchProvider, SearchResult

logger = logging.getLogger(__name__)


_PER_QUERY_TIMEOUT_S = 60.0
_MAX_CONTENT_CHARS = 3000
_MAX_TOTAL_OUTPUT_CHARS = 30_000
_COMPANY_SITE_CATEGORIES = ["About", "Pricing", "Documentation", "Blogs", "Careers", "Media"]


def _host(url: str) -> str:
    netloc = urlparse(url).netloc.lower()
    return netloc[4:] if netloc.startswith("www.") else netloc


def _format_source_block(*, idx: int, title: str, url: str, source_type: str, body: str) -> str:
    body = (body or "").strip()
    if len(body) > _MAX_CONTENT_CHARS:
        body = body[:_MAX_CONTENT_CHARS] + "\n[... truncated]"
    return (
        f"--- SOURCE {idx}: {title or url} ---\n"
        f"URL: {url}\n"
        f"Type: {source_type}\n\n"
        f"CONTENT:\n{body}\n\n"
        f"{'-' * 80}\n"
    )


def _config_value(config: RunnableConfig | None, key: str, default: str = "") -> str:
    if not config:
        return default
    configurable = config.get("configurable", {}) or {}
    return configurable.get(key, default)


def _search_provider(config: RunnableConfig | None) -> SearchProvider | None:
    if not config:
        return None
    return (config.get("configurable", {}) or {}).get("search_provider")  # type: ignore[no-any-return]


def _coalesce_blocks(blocks: list[str]) -> str:
    out: list[str] = []
    total = 0
    for b in blocks:
        if total + len(b) > _MAX_TOTAL_OUTPUT_CHARS:
            out.append("\n[... output truncated at character cap]\n")
            break
        out.append(b)
        total += len(b)
    return "".join(out) or "No results."


async def _safe_search(
    provider: SearchProvider, query: str, **kwargs: object
) -> list[SearchResult]:
    try:
        return await asyncio.wait_for(provider.search(query, **kwargs), timeout=_PER_QUERY_TIMEOUT_S)  # type: ignore[arg-type]
    except Exception as e:  # noqa: BLE001 — log & degrade, never crash the researcher
        logger.warning("tavily search failed for %r: %s", query, e)
        return []


async def _safe_extract(provider: SearchProvider, urls: list[str]) -> list[ExtractedPage]:
    if not urls:
        return []
    try:
        return await asyncio.wait_for(
            provider.extract(urls, extract_depth="advanced"), timeout=_PER_QUERY_TIMEOUT_S
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("tavily extract failed for %d urls: %s", len(urls), e)
        return []


async def _safe_map(provider: SearchProvider, url: str) -> list[MappedUrl]:
    try:
        return await asyncio.wait_for(
            provider.map(url, max_depth=2, limit=20, categories=_COMPANY_SITE_CATEGORIES),
            timeout=_PER_QUERY_TIMEOUT_S,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("tavily map failed for %s: %s", url, e)
        return []


@tool(
    description=(
        "Scrape and search the target company's own website. Use this when the "
        "answer lives on the company's pages (overview, products, pricing, blog, "
        "case studies). Provide 1-3 short queries; you also get a one-shot map+extract "
        "of the company site appended automatically on the first call."
    ),
)
async def company_site_search(
    queries: list[str],
    max_results: Annotated[int, InjectedToolArg] = 4,
    config: RunnableConfig = None,  # type: ignore[assignment]  # langchain auto-injects
) -> str:
    provider = _search_provider(config)
    website = _config_value(config, "website")
    if provider is None or not website:
        return "Error: company_site_search is not configured (missing search provider or website)."

    domain = _host(website)
    blocks: list[str] = []
    seen_urls: set[str] = set()

    # Domain-restricted search per query.
    search_results = await asyncio.gather(
        *[
            _safe_search(
                provider,
                q,
                max_results=max_results,
                search_depth="advanced",
                topic="general",
                include_domains=[domain] if domain else None,
                include_raw_content="markdown",
            )
            for q in queries
        ]
    )

    idx = 1
    for results in search_results:
        for r in results:
            if r.url in seen_urls:
                continue
            seen_urls.add(r.url)
            body = r.content or r.snippet
            blocks.append(
                _format_source_block(
                    idx=idx, title=r.title, url=r.url, source_type="company_site", body=body
                )
            )
            idx += 1

    # Map + extract of the company site as a single supplemental dump (first call only).
    if not _config_value(config, "_company_site_mapped"):
        mapped = await _safe_map(provider, website)
        target_urls = [website] + [m.url for m in mapped if m.url not in seen_urls][:8]
        extracted = await _safe_extract(provider, target_urls)
        for page in extracted:
            if page.url in seen_urls or not page.content:
                continue
            seen_urls.add(page.url)
            blocks.append(
                _format_source_block(
                    idx=idx,
                    title=page.title or page.url,
                    url=page.url,
                    source_type="company_site",
                    body=page.content,
                )
            )
            idx += 1

    return _coalesce_blocks(blocks)


_WebTopic = Literal["general", "news", "finance"]


@tool(
    description=(
        "Search the web for information about the target company. Use this for "
        "external coverage: news, funding, hiring, reviews, financials, "
        "partnerships, criticism. The company name is prepended to every query "
        "automatically — do not include it yourself."
    ),
)
async def web_company_search(
    queries: list[str],
    topic: _WebTopic = "general",
    max_results: Annotated[int, InjectedToolArg] = 4,
    config: RunnableConfig = None,  # type: ignore[assignment]  # langchain auto-injects
) -> str:
    provider = _search_provider(config)
    company_name = _config_value(config, "company_name")
    if provider is None or not company_name:
        return "Error: web_company_search is not configured (missing search provider or company name)."

    anchored = [f"{company_name} {q.strip()}" for q in queries if q.strip()]
    if not anchored:
        return "Error: no queries provided."

    search_results = await asyncio.gather(
        *[
            _safe_search(
                provider,
                q,
                max_results=max_results,
                search_depth="advanced",
                topic=topic,
                include_raw_content="markdown",
            )
            for q in anchored
        ]
    )

    blocks: list[str] = []
    seen_urls: set[str] = set()
    idx = 1
    for results in search_results:
        for r in results:
            if r.url in seen_urls:
                continue
            seen_urls.add(r.url)
            body = r.content or r.snippet
            blocks.append(
                _format_source_block(
                    idx=idx, title=r.title, url=r.url, source_type="web", body=body
                )
            )
            idx += 1

    return _coalesce_blocks(blocks)
