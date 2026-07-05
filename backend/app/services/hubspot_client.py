"""Thin HubSpot CRM client — deal intake + Note write-back.

Uses a Private App access token (single account, no OAuth flow). Only the
stable, documented v3/v4 endpoints are used:
- CRM Search API to find deals in the configured stage
- CRM v4 Associations API to read a deal's linked company/contact
- CRM v3 object reads for company/contact properties
- CRM v3 Notes + the "default association" shortcut to write the dashboard
  link back onto the deal, without needing to know numeric association-type
  IDs (those vary by portal/custom association setup).

Every call is best-effort at the sync-cycle level: a failure here should
never take down the whole poll cycle, so callers log and continue rather
than raise where reasonable.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)

BASE_URL = "https://api.hubapi.com"


class HubspotError(Exception):
    pass


def _client() -> httpx.AsyncClient:
    token = get_settings().hubspot_access_token
    return httpx.AsyncClient(
        base_url=BASE_URL,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=30.0,
    )


async def search_deals_in_stage(*, stage_id: str, pipeline_id: str = "") -> list[dict[str, Any]]:
    filters: list[dict[str, str]] = [
        {"propertyName": "dealstage", "operator": "EQ", "value": stage_id}
    ]
    if pipeline_id:
        filters.append({"propertyName": "pipeline", "operator": "EQ", "value": pipeline_id})

    async with _client() as client:
        res = await client.post(
            "/crm/v3/objects/deals/search",
            json={
                "filterGroups": [{"filters": filters}],
                "properties": ["dealname", "amount", "dealstage", "pipeline"],
                "limit": 100,
            },
        )
    if res.status_code != 200:
        raise HubspotError(f"deal search failed: {res.status_code} {res.text}")
    return res.json().get("results", [])


async def get_deal_associations(deal_id: str, to_object_type: str) -> list[str]:
    """`to_object_type` is the plural HubSpot object type: "companies" | "contacts"."""
    async with _client() as client:
        res = await client.get(f"/crm/v4/objects/deals/{deal_id}/associations/{to_object_type}")
    if res.status_code == 404:
        return []
    if res.status_code != 200:
        log.warning("hubspot_associations_failed", deal_id=deal_id, status=res.status_code)
        return []
    return [str(r["toObjectId"]) for r in res.json().get("results", [])]


async def get_object_properties(
    object_type: str, object_id: str, properties: list[str]
) -> dict[str, Any] | None:
    async with _client() as client:
        res = await client.get(
            f"/crm/v3/objects/{object_type}/{object_id}",
            params={"properties": ",".join(properties)},
        )
    if res.status_code != 200:
        log.warning(
            "hubspot_object_read_failed", object_type=object_type, object_id=object_id,
            status=res.status_code,
        )
        return None
    return res.json().get("properties", {})


async def create_note_with_association(
    *, body_html: str, deal_id: str, contact_id: str | None = None
) -> None:
    async with _client() as client:
        res = await client.post(
            "/crm/v3/objects/notes",
            json={
                "properties": {
                    "hs_note_body": body_html,
                    "hs_timestamp": str(int(time.time() * 1000)),
                }
            },
        )
        if res.status_code not in (200, 201):
            raise HubspotError(f"note create failed: {res.status_code} {res.text}")
        note_id = res.json()["id"]

        for object_type, object_id in (("deals", deal_id), ("contacts", contact_id)):
            if not object_id:
                continue
            assoc = await client.put(
                f"/crm/v3/objects/notes/{note_id}/associations/default/{object_type}/{object_id}"
            )
            if assoc.status_code not in (200, 201, 204):
                log.warning(
                    "hubspot_note_association_failed",
                    note_id=note_id,
                    object_type=object_type,
                    object_id=object_id,
                    status=assoc.status_code,
                )
