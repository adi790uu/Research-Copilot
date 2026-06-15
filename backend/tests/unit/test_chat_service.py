"""Unit tests for chat prompt assembly and RAG context selection."""

from app.domain.report import ReportContent, ReportSection, Source
from app.services.chat_service import _assemble_prompt, _format_report_context


def _report() -> ReportContent:
    return ReportContent(
        company_overview=ReportSection(
            content="Acme builds widgets.", source_ids=["s1"]
        ),
        products_and_services=ReportSection(
            content="Widget A, Widget B.", source_ids=["s2"]
        ),
        target_customers=ReportSection(content="Mid-market manufacturers."),
        business_signals=ReportSection(
            content="Raised $20M Series B in 2025.", source_ids=["s3"]
        ),
        risks_and_challenges=ReportSection(content="Margin pressure."),
        discovery_questions=ReportSection(content="What is your top KPI?"),
        outreach_strategy=ReportSection(content="Lead with ROI."),
        unknowns=ReportSection(content="Compliance posture."),
        sources=[
            Source(id="s1", url="https://acme.test/about", title="About Acme"),
            Source(id="s2", url="https://acme.test/products", title="Products"),
            Source(id="s3", url="https://news.test/series-b", title="Series B"),
        ],
    )


def test_format_report_context_includes_all_sections_and_citations() -> None:
    block = _format_report_context(_report())

    assert "Company overview [s1]" in block
    assert "Products & services [s2]" in block
    assert "Target customers" in block
    assert "Acme builds widgets." in block
    assert "[s3] Series B — https://news.test/series-b" in block
    # Sections without source_ids should not get a trailing citation suffix.
    assert "Target customers\nMid-market" in block


def test_assemble_prompt_includes_briefing_and_user_message() -> None:
    context = _format_report_context(_report())
    prompt = _assemble_prompt(
        context,
        prior=[("user", "Hello"), ("assistant", "Hi there.")],
        user_message="When did they raise?",
    )

    assert "AI sales research assistant" in prompt
    assert "Raised $20M Series B in 2025." in prompt
    assert "User: Hello" in prompt
    assert "Assistant: Hi there." in prompt
    assert prompt.rstrip().endswith("User: When did they raise?\nAssistant:")


def test_assemble_prompt_handles_missing_briefing() -> None:
    prompt = _assemble_prompt(
        context_block="",
        prior=[],
        user_message="What is the weather?",
    )

    assert "(no briefing available" in prompt
    assert "(no prior turns)" in prompt
    assert prompt.rstrip().endswith("User: What is the weather?\nAssistant:")
