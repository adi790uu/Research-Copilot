"""Final report generation.

Pass 1: structured_output(ReportContent) — fills all 8 sections directly.
Pass 2: per-section reviewer pass that re-checks citation IDs and tightens prose.

The result lands in `state["report"]` as a `ReportContent` instance; the
service layer JSON-encodes it for the `research_jobs.final_report` Text
column.
"""

from __future__ import annotations

import asyncio
import logging
from typing import cast

from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig

from app.domain.report import ReportContent, ReportSection, Source
from app.workflow.helpers import (
    _create_model,
    _get_today_str,
    _is_token_limit_exceeded,
)
from app.workflow.prompts import (
    REPORT_SECTIONS,
    final_report_generation_prompt,
    review_and_stitch_prompt,
    section_catalog,
)
from app.workflow.state import AgentState, _PolishedSection

logger = logging.getLogger(__name__)


def _sources_block(sources: list[Source]) -> str:
    if not sources:
        return "(no sources collected)"
    return "\n".join(f"[{s.id}] {s.title} — {s.url}" for s in sources)


def _filter_section_source_ids(section: ReportSection, valid_ids: set[str]) -> ReportSection:
    return ReportSection(
        content=section.content,
        source_ids=[sid for sid in section.source_ids if sid in valid_ids],
    )


async def final_report_generation(state: AgentState, config: RunnableConfig) -> dict:
    company_name = state.get("company_name", "")
    website = state.get("website", "")
    research_brief = state.get("research_brief", "") or ""
    notes = state.get("notes", []) or []
    findings = "\n\n".join(notes) if notes else "(no findings)"
    sources = list(state.get("sources", []) or [])
    valid_ids = {s.id for s in sources}

    # ----- Pass 1: structured draft of all 8 sections ---------------------
    writer = _create_model(temperature=0.2).with_structured_output(ReportContent).with_retry(
        stop_after_attempt=2
    )
    truncation_attempts = 0
    findings_text = findings
    draft: ReportContent | None = None
    while truncation_attempts <= 3:
        prompt = final_report_generation_prompt.format(
            company_name=company_name,
            website=website,
            research_brief=research_brief,
            findings=findings_text,
            sources_block=_sources_block(sources),
            section_catalog=section_catalog(),
            date=_get_today_str(),
        )
        try:
            draft = cast(
                ReportContent,
                await writer.ainvoke([HumanMessage(content=prompt)]),
            )
            break
        except Exception as e:  # noqa: BLE001
            if not _is_token_limit_exceeded(e) or truncation_attempts >= 3:
                logger.exception("final_report draft failed")
                return {
                    "report": _fallback_report(
                        findings_text=findings_text, sources=sources, error=str(e)
                    ),
                    "notes": {"type": "override", "value": []},
                }
            truncation_attempts += 1
            findings_text = findings_text[: int(len(findings_text) * 0.7)] or findings_text[:5000]

    if draft is None:
        return {
            "report": _fallback_report(
                findings_text=findings_text, sources=sources, error="empty draft"
            ),
            "notes": {"type": "override", "value": []},
        }

    # Drop any source IDs the writer hallucinated.
    for name in REPORT_SECTIONS:
        section = getattr(draft, name)
        setattr(draft, name, _filter_section_source_ids(section, valid_ids))
    draft = draft.model_copy(update={"sources": sources})

    # ----- Pass 2: per-section review/polish ------------------------------
    reviewer = _create_model(temperature=0.2).with_structured_output(_PolishedSection).with_retry(
        stop_after_attempt=2
    )

    async def _review_one(name: str) -> tuple[str, ReportSection]:
        section = getattr(draft, name)
        if not section.content or not section.content.strip():
            return name, section
        prompt = review_and_stitch_prompt.format(
            company_name=company_name,
            section=name,
            draft_content=section.content,
            findings=findings_text[:6000],
            valid_source_ids=", ".join(sorted(valid_ids)) or "(none)",
            date=_get_today_str(),
        )
        try:
            polished = cast(
                _PolishedSection,
                await reviewer.ainvoke([HumanMessage(content=prompt)]),
            )
            return name, _filter_section_source_ids(
                ReportSection(content=polished.content, source_ids=polished.source_ids),
                valid_ids,
            )
        except Exception:  # noqa: BLE001
            logger.exception("final_report review failed for section %s; keeping draft", name)
            return name, section

    polished_pairs = await asyncio.gather(*[_review_one(n) for n in REPORT_SECTIONS])
    polished_map = dict(polished_pairs)

    final = draft.model_copy(update={**polished_map, "sources": sources})

    return {
        "report": final,
        # Clear notes so a re-run doesn't accumulate.
        "notes": {"type": "override", "value": []},
    }


def _fallback_report(
    *, findings_text: str, sources: list[Source], error: str
) -> ReportContent:
    placeholder = ReportSection(
        content=(
            "Report generation failed to produce structured output. "
            f"Underlying error: {error[:200]}"
        ),
        source_ids=[],
    )
    summary = ReportSection(
        content=(
            "Findings collected but final synthesis failed. Raw notes preview:\n\n"
            + findings_text[:1500]
        ),
        source_ids=[],
    )
    return ReportContent(
        company_overview=summary,
        products_and_services=placeholder,
        target_customers=placeholder,
        business_signals=placeholder,
        risks_and_challenges=placeholder,
        discovery_questions=placeholder,
        outreach_strategy=placeholder,
        unknowns=ReportSection(
            content="Final report generation failed; see other sections for raw notes.",
            source_ids=[],
        ),
        sources=sources,
    )
