"""Report section identifiers — kept in one place so prompts and code agree."""

SECTIONS: tuple[str, ...] = (
    "company_overview",
    "products_and_services",
    "target_customers",
    "business_signals",
    "risks_and_challenges",
    "discovery_questions",
    "outreach_strategy",
    "unknowns",
)

SECTION_DESCRIPTIONS: dict[str, str] = {
    "company_overview": "what the company does, scale, geography, leadership",
    "products_and_services": "core offerings, packaging, pricing if public",
    "target_customers": "ICP, named customers, segments served",
    "business_signals": "funding, hiring trends, launches, partnerships",
    "risks_and_challenges": "competitive pressure, regulatory, market headwinds",
    "discovery_questions": "questions a seller should ask on a discovery call",
    "outreach_strategy": "channels, hooks, message angles for outreach",
    "unknowns": "what we could not determine and why it matters",
}
