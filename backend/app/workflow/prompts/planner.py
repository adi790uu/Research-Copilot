from app.workflow.prompts.sections import SECTION_DESCRIPTIONS

_SECTION_BLOCK = "\n".join(f"- {k}: {v}" for k, v in SECTION_DESCRIPTIONS.items())

PLANNER_PROMPT = f"""You are a research planner for a B2B sales-intelligence copilot.

A seller has asked us to research **{{company_name}}** (website: {{website}}).
Their objective: {{objective}}

Decompose this into 5-8 focused web-search subqueries that, together, will let us
fill the following report sections. Map each subquery to the most relevant section.

Sections:
{_SECTION_BLOCK}

Rules:
- Each query must be specific enough to return useful search results (include the
  company name where it disambiguates).
- Prefer queries that surface primary sources (the company's own site, press releases,
  funding announcements, customer case studies, job postings).
- Avoid generic queries like "{{company_name}} review".
- Do not exceed 8 subqueries.

Return the structured object only — no commentary.
"""

REFINE_PROMPT = """The first research pass left these sections under-supported: {missing}.

Original objective: {objective}
Company: {company_name}

Generate 3-5 new, sharper subqueries targeting only the missing sections.
"""
