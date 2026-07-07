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


def _format_report(report_json: str) -> str:
    try:
        data = json.loads(report_json)
    except (ValueError, TypeError):
        return report_json[: _MAX_SECTION_CHARS * 8]

    parts: list[str] = []
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


async def build_research_block(brief: BriefORM, index: int) -> str:
    """One research's context: metadata + report + sources (report may be
    pending)."""
    header = (
        f"# Research {index}: {brief.company_name} ({brief.website})\n"
        f"Objective: {brief.objective}"
    )
    job = await job_store.get_job_by_brief(brief.id)
    if job and job.get("final_report"):
        report_md = _format_report(str(job.get("final_report") or ""))
        sources_block = _format_sources(job.get("sources") or [])
        return f"{header}\n\n{report_md}\n\n## Sources for {brief.company_name}\n{sources_block}"
    return f"{header}\n\n(Research is still in progress — no completed report yet.)"


def build_system_prompt(research_blocks: list[str]) -> str:
    """Render the grounding system prompt from the attached researches' blocks."""
    joined = "\n\n---\n\n".join(research_blocks) if research_blocks else "(no researches attached)"
    return copilot_system_prompt.format(date=_get_today_str(), research=joined)
