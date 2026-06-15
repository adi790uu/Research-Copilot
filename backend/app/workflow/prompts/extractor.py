EXTRACTOR_PROMPT = """You are extracting factual claims from one web page for a sales-intelligence report.

Company under research: {company_name}
Target section: {section}

Source title: {title}
Source url: {url}
Source snippet/content:
\"\"\"
{content}
\"\"\"

Extract 0-5 atomic, citation-worthy facts that are directly relevant to the
target section above. Each fact must:
- Be a single complete sentence.
- Be grounded *only* in the provided source content.
- Not include the source URL inline — that is tracked separately.

If the source has nothing useful for this section, return an empty list.
"""
