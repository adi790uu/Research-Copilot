"""Resolve a meeting contact's public identity via People Data Labs.

Tries an email-keyed lookup first (cheapest, most direct when PDL has it
indexed), then falls back to name + company: PDL's own identity graph
(LinkedIn + company + work-history records, matched with a numeric
`likelihood` score) disambiguates common names far more reliably than a
name-only web search, which has no way to tell two people with the same name
apart. Matches below `pdl_min_likelihood` are treated as no match — an
explicit "unresolved" beats a confident-looking wrong person.
"""

from __future__ import annotations

from urllib.parse import urlparse

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)

PDL_ENRICH_URL = "https://api.peopledatalabs.com/v5/person/enrich"


async def resolve_contact(
    *, name: str, email: str | None, company_name: str, website: str
) -> dict:
    settings = get_settings()
    if not settings.pdl_api_key:
        return {"status": "skipped", "source": None}

    company_guess = _domain_root(website) or company_name

    async with httpx.AsyncClient(timeout=15.0) as client:
        if email:
            body = await _enrich(client, settings.pdl_api_key, {"email": email})
            if body is not None:
                return _to_resolution(
                    body, source="pdl_email", threshold=settings.pdl_min_likelihood
                )

        body = await _enrich(client, settings.pdl_api_key, {"name": name, "company": company_guess})
        if body is not None:
            return _to_resolution(
                body, source="pdl_name_company", threshold=settings.pdl_min_likelihood
            )

    return {"status": "unresolved", "source": None}


async def _enrich(client: httpx.AsyncClient, api_key: str, params: dict[str, str]) -> dict | None:
    try:
        res = await client.get(PDL_ENRICH_URL, params=params, headers={"X-Api-Key": api_key})
    except httpx.HTTPError as exc:
        log.warning("pdl_request_failed", error=str(exc))
        return None
    if res.status_code != 200:
        return None
    return res.json()


def _to_resolution(body: dict, *, source: str, threshold: int) -> dict:
    likelihood = body.get("likelihood") or 0
    if likelihood < threshold:
        return {"status": "unresolved", "source": source, "likelihood": likelihood}

    data = body.get("data") or {}
    return {
        "status": "resolved",
        "source": source,
        "likelihood": likelihood,
        "name": data.get("full_name"),
        "title": data.get("job_title"),
        "company": data.get("job_company_name"),
        "company_website": data.get("job_company_website"),
        "linkedin_url": data.get("linkedin_url"),
        "location": data.get("location_name"),
    }


def _domain_root(website: str) -> str:
    try:
        netloc = urlparse(website if "://" in website else f"https://{website}").netloc
        host = netloc.removeprefix("www.")
        return host.split(".")[0] if host else ""
    except ValueError:
        return ""
