SYNTHESIZER_PROMPT = """You are writing the **{section}** section of a sales-intelligence
briefing on {company_name}.

Section purpose: {section_description}
Original seller objective: {objective}

Use *only* the facts below. Each fact is tagged with a source id; reference the
source ids inline using bracketed citations like [src_3] where the claim depends
on that source. Do not invent facts. If the facts are sparse, write a shorter
section honestly rather than padding.

Facts available for this section:
{facts}

Write 2-5 tight paragraphs (or a bulleted list where it reads better). Plain prose,
no headings — the section header is added by the assembler.
"""

UNKNOWNS_PROMPT = """You are writing the **unknowns** section of a sales-intelligence
briefing on {company_name}.

Original objective: {objective}
Sections that ended up thin or empty: {thin_sections}

In 3-6 bullet points, name the most important questions we could *not* answer from
public sources, and why each gap matters for the seller's objective.
"""
