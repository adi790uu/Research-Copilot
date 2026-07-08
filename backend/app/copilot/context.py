from __future__ import annotations

import json

from app.copilot.prompts import copilot_system_prompt
from app.persistence.models import BriefORM
from app.services import job_store
from app.workflow.helpers import _get_today_str

_MAX_SECTION_CHARS = 2500
_MAX_SOURCES_PER_REPORT = 60


def _format_sources(sources: list[dict]) -> str:
    if not sources:
        return "(no sources)"
    out: list[str] = []
    for s in sources[:_MAX_SOURCES_PER_REPORT]:
        sid = s.get("id") or "?"
        title = s.get("title") or s.get("url") or "?"
        url = s.get("url") or ""
        out.append(f"[{sid}] {title} — {url}")
    if len(sources) > _MAX_SOURCES_PER_REPORT:
        out.append(f"… +{len(sources) - _MAX_SOURCES_PER_REPORT} more sources")
    return "\n".join(out)


def _format_report(report: dict | str) -> str:
    if isinstance(report, str):
        try:
            data = json.loads(report)
        except (ValueError, TypeError):
            return report[: _MAX_SECTION_CHARS * 8]
    else:
        data = report

    parts: list[str] = []
    answer = (data.get("answer") or "").strip()
    if answer:
        parts.append(f"### Answer\n{answer}")
    summary = (data.get("summary") or "").strip()
    if summary:
        parts.append(f"### Summary\n{summary}")

    for sec in data.get("sections") or []:
        label = (sec.get("heading") or "Section").strip()
        content = (sec.get("content") or "").strip()
        if not content:
            continue
        if len(content) > _MAX_SECTION_CHARS:
            content = content[:_MAX_SECTION_CHARS] + " […truncated]"
        cites = sec.get("source_ids") or []
        cite_strip = f"  (cites: {', '.join(cites)})" if cites else ""
        parts.append(f"### {label}{cite_strip}\n{content}")
    return "\n\n".join(parts)


def _format_person(person: dict) -> str:
    parts: list[str] = ["## Meeting contact"]
    headline = (person.get("headline") or "").strip()
    if headline:
        parts.append(headline)
    summary = (person.get("summary") or "").strip()
    if summary:
        parts.append(summary)
    for sec in person.get("sections") or []:
        label = (sec.get("heading") or "Section").strip()
        content = (sec.get("content") or "").strip()
        if not content:
            continue
        if len(content) > _MAX_SECTION_CHARS:
            content = content[:_MAX_SECTION_CHARS] + " […truncated]"
        parts.append(f"### {label}\n{content}")
    return "\n\n".join(parts)


def _format_pitch(pitch: dict) -> str:
    parts: list[str] = ["## Pitch"]
    headline = (pitch.get("headline") or "").strip()
    if headline:
        parts.append(f"**{headline}**")
    why_now = (pitch.get("why_now") or "").strip()
    if why_now:
        parts.append(f"Why now: {why_now}")
    points = pitch.get("talking_points") or []
    if points:
        lines = [
            f"- {(p.get('point') or '').strip()}"
            + (f" — {(p.get('rationale') or '').strip()}" if p.get("rationale") else "")
            for p in points
        ]
        parts.append("Talking points:\n" + "\n".join(lines))
    opening = (pitch.get("opening_message") or "").strip()
    if opening:
        parts.append(f"Opening message:\n{opening}")
    objections = pitch.get("objections") or []
    if objections:
        lines = [
            f"- Objection: {(o.get('objection') or '').strip()}\n  Response: {(o.get('response') or '').strip()}"
            for o in objections
        ]
        parts.append("Objections:\n" + "\n".join(lines))
    return "\n\n".join(parts)


async def build_research_block(brief: BriefORM, index: int) -> str:
    """One research's context: metadata + report + sources (report may be
    pending)."""
    header = (
        f"# Research {index}: {brief.company_name} ({brief.website})\n"
        f"Objective: {brief.objective}"
    )
    job = await job_store.get_job_by_brief(brief.id)
    company_report = job.get("company_report") if job else None
    if company_report:
        report_md = _format_report(company_report)
        sources = company_report.get("sources") or []
        sources_block = _format_sources(sources)
        blocks = [header, report_md]

        person = job.get("person_report") if job else None
        if person and person.get("verified"):
            blocks.append(_format_person(person))

        pitch = job.get("pitch") if job else None
        if pitch:
            blocks.append(_format_pitch(pitch))

        blocks.append(f"## Sources for {brief.company_name}\n{sources_block}")
        return "\n\n".join(blocks)
    return f"{header}\n\n(Research is still in progress — no completed report yet.)"


def build_system_prompt(research_blocks: list[str]) -> str:
    """Render the grounding system prompt from the attached researches' blocks."""
    joined = "\n\n---\n\n".join(research_blocks) if research_blocks else "(no researches attached)"
    return copilot_system_prompt.format(date=_get_today_str(), research=joined)
