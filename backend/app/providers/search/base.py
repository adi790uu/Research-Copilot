from collections.abc import Sequence
from typing import Literal, Protocol

from pydantic import BaseModel


class SearchResult(BaseModel):
    url: str
    title: str
    snippet: str
    content: str | None = None


class ExtractedPage(BaseModel):
    """One scraped page returned by `extract` / `crawl`."""

    url: str
    content: str
    title: str | None = None


class MappedUrl(BaseModel):
    """One discovered URL returned by `map`."""

    url: str
    title: str | None = None


SearchTopic = Literal["general", "news", "finance"]


class SearchProvider(Protocol):
    async def search(
        self,
        query: str,
        *,
        max_results: int = 5,
        search_depth: Literal["basic", "advanced"] = "basic",
        topic: SearchTopic = "general",
        include_domains: Sequence[str] | None = None,
        include_raw_content: bool | Literal["markdown", "text"] = False,
        time_range: Literal["day", "week", "month", "year"] | None = None,
    ) -> list[SearchResult]: ...

    async def extract(
        self,
        urls: Sequence[str],
        *,
        extract_depth: Literal["basic", "advanced"] = "basic",
    ) -> list[ExtractedPage]: ...

    async def map(
        self,
        url: str,
        *,
        max_depth: int = 2,
        limit: int = 30,
        categories: Sequence[str] | None = None,
    ) -> list[MappedUrl]: ...
