"""Draft a seller's company context by scraping their site and extracting the
profile fields with an LLM. The draft is returned for the user to review and
edit — it is never saved automatically."""

from __future__ import annotations

import re
from typing import cast
from urllib.parse import urljoin, urlparse

import httpx
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from app.core.errors import ProviderError, ValidationError
from app.domain.user import CompanyContext
from app.workflow.helpers import _create_model

_MAX_TEXT_CHARS = 12_000
_FETCH_TIMEOUT = 15.0
_USER_AGENT = "Mozilla/5.0 (research-copilot company-context)"
# A few common pages that tend to carry positioning/proof, best-effort.
_EXTRA_PATHS = ("/about", "/product", "/customers")


class _CompanyContextDraft(BaseModel):
    """LLM extraction target. Descriptions guide the model; every field is
    left empty when the site does not clearly support it (no guessing)."""

    what_you_sell: str = Field(
        default="",
        description="One line: the product or service the company sells. Empty if unclear.",
    )
    value_props: str = Field(
        default="",
        description="The core benefits/value propositions the company leads with. Empty if unclear.",
    )
    icp: str = Field(
        default="",
        description="Who they sell to — their ideal customer profile (roles, company type, segment). Empty if unclear.",
    )
    differentiators: str = Field(
        default="",
        description="What sets them apart from alternatives. Empty if the site doesn't say.",
    )
    proof_points: str = Field(
        default="",
        description="Concrete proof: metrics, notable customers, case-study outcomes. Empty if none stated.",
    )
    notes: str = Field(
        default="",
        description="Any other useful positioning/boilerplate worth pitching from. Empty if nothing extra.",
    )


def _normalize(website: str) -> str:
    site = website.strip()
    if not site:
        raise ValidationError("A website is required to autofill.")
    if "://" not in site:
        site = f"https://{site}"
    parsed = urlparse(site)
    if not parsed.netloc:
        raise ValidationError("That doesn't look like a valid website.")
    return site


def _html_to_text(html: str) -> str:
    # Drop script/style/noscript blocks, then strip tags.
    cleaned = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"&nbsp;", " ", cleaned)
    cleaned = re.sub(r"&amp;", "&", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


async def _scrape(website: str) -> str:
    """Fetch the homepage plus a few common pages; return concatenated text."""
    headers = {"User-Agent": _USER_AGENT}
    texts: list[str] = []
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=_FETCH_TIMEOUT, headers=headers
    ) as client:
        try:
            resp = await client.get(website)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderError(f"Could not reach {website}.") from exc
        texts.append(_html_to_text(resp.text))

        for path in _EXTRA_PATHS:
            if len(" ".join(texts)) >= _MAX_TEXT_CHARS:
                break
            try:
                r = await client.get(urljoin(website, path))
                if r.status_code == 200 and "text/html" in r.headers.get("content-type", ""):
                    texts.append(_html_to_text(r.text))
            except httpx.HTTPError:
                continue  # best-effort; skip pages that fail

    text = "\n\n".join(t for t in texts if t)
    if len(text) < 80:
        raise ProviderError("The site had too little readable text to work with.")
    return text[:_MAX_TEXT_CHARS]


_PROMPT = """You are helping a seller fill in their own company profile so it can \
later be used to build sales pitches. Below is text scraped from their website.

Extract the profile fields from what the text actually says. Write in the \
company's own voice, concise and concrete. Leave a field EMPTY ("") if the site \
does not clearly support it — never invent facts, customers, or metrics.

<website_text>
{text}
</website_text>
"""


async def draft_company_context(website: str) -> CompanyContext:
    site = _normalize(website)
    text = await _scrape(site)

    model = (
        _create_model(temperature=0.2)
        .with_structured_output(_CompanyContextDraft)
        .with_retry(stop_after_attempt=2)
    )
    try:
        draft = cast(
            _CompanyContextDraft,
            await model.ainvoke([HumanMessage(content=_PROMPT.format(text=text))]),
        )
    except Exception as exc:  # noqa: BLE001 — surface any LLM failure as a provider error
        raise ProviderError("Could not read the site into a profile.") from exc

    return CompanyContext(**draft.model_dump())
