import asyncio
from collections import defaultdict

from app.domain.report import ReportSection
from app.workflow.deps import WorkflowDeps
from app.workflow.prompts.sections import SECTION_DESCRIPTIONS, SECTIONS
from app.workflow.prompts.synthesizer import SYNTHESIZER_PROMPT, UNKNOWNS_PROMPT
from app.workflow.state import Fact, GraphState, NodeError


def _facts_block(facts: list[Fact]) -> str:
    return "\n".join(f"- [{f.source_id}] {f.text}" for f in facts)


async def synthesizer(state: GraphState, deps: WorkflowDeps) -> GraphState:
    facts = state.get("facts", [])
    by_section: dict[str, list[Fact]] = defaultdict(list)
    for f in facts:
        by_section[f.section].append(f)

    company = state["company_name"]
    objective = state["objective"]

    sections_to_write = [s for s in SECTIONS if s != "unknowns"]
    thin = [s for s in sections_to_write if len(by_section.get(s, [])) < 2]

    async def _write(section: str) -> tuple[str, ReportSection, NodeError | None]:
        section_facts = by_section.get(section, [])
        if not section_facts:
            return section, ReportSection(content="Not enough public information found.", source_ids=[]), None
        prompt = SYNTHESIZER_PROMPT.format(
            section=section,
            section_description=SECTION_DESCRIPTIONS[section],
            company_name=company,
            objective=objective,
            facts=_facts_block(section_facts),
        )
        try:
            content = await deps.llm.complete(prompt, temperature=0.3)
        except Exception as e:
            return (
                section,
                ReportSection(content="", source_ids=[]),
                NodeError(node="synthesizer", message=f"{section}: {e}"),
            )
        return (
            section,
            ReportSection(
                content=content.strip(),
                source_ids=sorted({f.source_id for f in section_facts}),
            ),
            None,
        )

    results = await asyncio.gather(*[_write(s) for s in sections_to_write])

    section_map: dict[str, ReportSection] = {}
    errors: list[NodeError] = []
    for name, sec, err in results:
        section_map[name] = sec
        if err:
            errors.append(err)

    # Unknowns section is generated from thin-section list, not from facts.
    try:
        unknowns_prompt = UNKNOWNS_PROMPT.format(
            company_name=company,
            objective=objective,
            thin_sections=", ".join(thin) if thin else "(none)",
        )
        unknowns_text = await deps.llm.complete(unknowns_prompt, temperature=0.3)
        section_map["unknowns"] = ReportSection(content=unknowns_text.strip(), source_ids=[])
    except Exception as e:
        errors.append(NodeError(node="synthesizer", message=f"unknowns: {e}"))
        section_map["unknowns"] = ReportSection(content="", source_ids=[])

    # Stash the drafted sections on state via the report field; the assembler
    # finalizes it with the sources list once the workflow reaches END.
    sources = state.get("sources", [])
    from app.domain.report import ReportContent

    report = ReportContent(
        company_overview=section_map["company_overview"],
        products_and_services=section_map["products_and_services"],
        target_customers=section_map["target_customers"],
        business_signals=section_map["business_signals"],
        risks_and_challenges=section_map["risks_and_challenges"],
        discovery_questions=section_map["discovery_questions"],
        outreach_strategy=section_map["outreach_strategy"],
        unknowns=section_map["unknowns"],
        sources=sources,
    )
    return {"report": report, "sections_drafted": True, "errors": errors}
