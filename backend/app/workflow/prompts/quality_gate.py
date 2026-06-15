QUALITY_GATE_PROMPT = """You are quality-checking a draft sales-intelligence briefing on {company_name}.

Original objective: {objective}

Per-section fact counts (source-grounded facts gathered for each section):
{fact_counts}

Total unique sources cited: {source_count}
Attempt: {attempt} of {max_attempts}

A section is considered "thin" if it has fewer than 2 grounded facts AND is one of
the seller-critical sections: company_overview, products_and_services, target_customers,
business_signals.

Decide:
- passed: True if no critical sections are thin, OR if we have already used all attempts.
- missing_sections: names of sections that are thin (only critical ones).
- refined_subqueries: if not passed, 3-5 sharper queries targeting the thin sections.
  Map each to its section. Omit if passed.
- reasoning: one sentence explaining the decision.
"""
