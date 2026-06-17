"""Report → HTML → PDF rendering.

Renders a structured `ReportContent` (8 sections + sources) as a
print-styled, self-contained HTML document and then asks WeasyPrint to
hand it back as PDF bytes.

WeasyPrint is loaded lazily so a missing Pango/Cairo on macOS doesn't take
the rest of the app down — the endpoint surfaces a clear 503 instead.
"""

from __future__ import annotations

import ctypes.util
import os
import platform
import re
from datetime import datetime
from html import escape

from app.domain.report import Report, ReportSection, Source


def _bootstrap_native_libs() -> None:
    """Make WeasyPrint's Pango/Cairo loads work on macOS + Homebrew."""
    if platform.system() != "Darwin":
        return

    prefixes = [p for p in ("/opt/homebrew/lib", "/usr/local/lib") if os.path.isdir(p)]
    if not prefixes:
        return

    original = ctypes.util.find_library

    def _patched(name: str) -> str | None:
        base = name.split(".", 1)[0]
        for prefix in prefixes:
            for filename in (f"lib{base}.dylib", f"lib{name}.dylib"):
                candidate = os.path.join(prefix, filename)
                if os.path.isfile(candidate):
                    return candidate
        return original(name)

    ctypes.util.find_library = _patched  # type: ignore[assignment]


_bootstrap_native_libs()


class PDFRenderError(RuntimeError):
    """Raised when WeasyPrint or its native deps can't render."""


# (attr, ordinal, title, kind). `kind` controls the body render:
#   - "prose": paragraphs.
#   - "list":  numbered list of questions (with `?` boundary fallback).
#   - "callout": prose inside a bordered callout box.
_SECTION_LABELS: list[tuple[str, str, str, str]] = [
    ("company_overview", "01", "Company overview", "prose"),
    ("products_and_services", "02", "Products & services", "prose"),
    ("target_customers", "03", "Target customers", "prose"),
    ("business_signals", "04", "Business signals", "prose"),
    ("risks_and_challenges", "05", "Risks & challenges", "prose"),
    ("discovery_questions", "06", "Discovery questions", "list"),
    ("outreach_strategy", "07", "Outreach strategy", "prose"),
    ("unknowns", "08", "Unknowns", "callout"),
]

_CITATION_RE = re.compile(r"\[([a-zA-Z0-9_,\s-]+)\]")


def render_report_html(
    report: Report,
    *,
    company_name: str,
    objective: str,
) -> str:
    """Produce a print-styled, self-contained HTML document for the report."""
    sources = report.content.sources
    src_index: dict[str, int] = {s.id: i + 1 for i, s in enumerate(sources)}

    body_parts: list[str] = [
        _cover_html(company_name, objective, report.created_at, len(sources)),
    ]
    for attr, ordinal, title, kind in _SECTION_LABELS:
        section: ReportSection = getattr(report.content, attr)
        body_parts.append(_section_html(ordinal, title, section, kind, src_index))
    body_parts.append(_sources_html(sources))

    return _DOC_TEMPLATE.format(
        title=escape(f"Brief — {company_name}"),
        company=escape(company_name),
        css=_CSS,
        body="\n".join(body_parts),
    )


def report_to_pdf(
    report: Report,
    *,
    company_name: str,
    objective: str,
) -> bytes:
    """Render the report to a PDF byte string."""
    try:
        from weasyprint import HTML  # type: ignore[import-untyped]
    except OSError as exc:  # pragma: no cover — env-dependent
        raise PDFRenderError(
            "PDF renderer unavailable: WeasyPrint couldn't load Pango/Cairo. "
            "On macOS: `brew install pango cairo` and run uvicorn with "
            "`DYLD_FALLBACK_LIBRARY_PATH=$(brew --prefix)/lib`. "
            f"Original error: {exc}"
        ) from exc
    except Exception as exc:  # pragma: no cover
        raise PDFRenderError(f"WeasyPrint import failed: {exc}") from exc

    html_str = render_report_html(
        report, company_name=company_name, objective=objective
    )
    return HTML(string=html_str).write_pdf()


# ---------------------------------------------------------------------------
# Section / cover renderers
# ---------------------------------------------------------------------------


def _cover_html(
    company_name: str, objective: str, created_at: datetime, source_count: int
) -> str:
    return f"""
<section class="cover">
  <p class="eyebrow">Research Copilot · Brief</p>
  <h1>{escape(company_name)}</h1>
  <p class="objective">{escape(objective)}</p>
  <p class="meta">
    Prepared {escape(created_at.strftime("%B %d, %Y"))}
    &nbsp;·&nbsp; 8 sections
    &nbsp;·&nbsp; {source_count} sources
  </p>
</section>
"""


def _section_html(
    ordinal: str,
    title: str,
    section: ReportSection,
    kind: str,
    src_index: dict[str, int],
) -> str:
    body = (section.content or "").strip()
    if not body:
        body_html = '<p class="empty">No content surfaced for this section.</p>'
    elif kind == "list":
        items = _split_questions(body)
        if len(items) > 1:
            lis = "\n".join(f"<li>{_render_text(q, src_index)}</li>" for q in items)
            body_html = f'<ol class="qlist">{lis}</ol>'
        else:
            body_html = _render_paragraphs(body, src_index)
    elif kind == "callout":
        body_html = f'<div class="callout">{_render_paragraphs(body, src_index)}</div>'
    else:
        body_html = _render_paragraphs(body, src_index)

    cited_strip = ""
    if section.source_ids:
        chips = " ".join(
            f'<span class="chip">{src_index[sid]:02d}</span>'
            for sid in section.source_ids
            if sid in src_index
        )
        if chips:
            cited_strip = f'<p class="cited"><span class="cited-label">Cited</span>{chips}</p>'

    return f"""
<section class="rsec">
  <h2><span class="ord">{ordinal}</span><span class="t">{escape(title)}</span></h2>
  {body_html}
  {cited_strip}
</section>
"""


def _sources_html(sources: list[Source]) -> str:
    if not sources:
        return """
<section class="sources">
  <h2><span class="ord">09</span><span class="t">Sources</span></h2>
  <p class="empty">No sources were retained.</p>
</section>
"""
    items = []
    for i, s in enumerate(sources, start=1):
        title = escape(s.title or s.url)
        url = escape(s.url)
        host = escape(_pretty_host(s.url))
        snippet = f'<p class="snippet">{escape(s.snippet)}</p>' if s.snippet else ""
        items.append(
            f"""
<li>
  <span class="src-num">{i:02d}</span>
  <div class="src-body">
    <a class="src-title" href="{url}">{title}</a>
    <p class="src-host">{host}</p>
    <p class="src-url">{url}</p>
    {snippet}
  </div>
</li>"""
        )
    return f"""
<section class="sources">
  <h2><span class="ord">09</span><span class="t">Sources</span></h2>
  <ol class="src-list">{''.join(items)}</ol>
</section>
"""


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------


def _render_paragraphs(text: str, src_index: dict[str, int]) -> str:
    paras = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    if not paras:
        paras = [text.strip()]
    return "".join(f"<p>{_render_text(p, src_index)}</p>" for p in paras)


def _render_text(text: str, src_index: dict[str, int]) -> str:
    """Escape + transform [src_…] markers into superscript citation chips."""
    out: list[str] = []
    last = 0
    for m in _CITATION_RE.finditer(text):
        start, end = m.span()
        out.append(escape(text[last:start]))
        ids = [i.strip() for i in m.group(1).split(",") if i.strip()]
        known = [src_index[i] for i in ids if i in src_index]
        if known:
            labels = ",".join(f"{n:02d}" for n in known)
            out.append(f'<sup class="cite">[{labels}]</sup>')
        else:
            out.append(escape(m.group(0)))
        last = end
    out.append(escape(text[last:]))
    return "".join(out).replace("\n", "<br>")


def _split_questions(text: str) -> list[str]:
    lines = [
        re.sub(r"^\s*(?:\d+[.)]|[-•*])\s*", "", line).strip()
        for line in re.split(r"\n+", text)
    ]
    lines = [line for line in lines if line]
    if len(lines) > 1:
        return lines
    parts = [p.strip() for p in text.split("?") if p.strip()]
    return [p if p.endswith("?") else f"{p}?" for p in parts]


def _pretty_host(url: str) -> str:
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or url
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return url


# ---------------------------------------------------------------------------
# HTML + CSS templates
# ---------------------------------------------------------------------------

_DOC_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>{css}</style>
</head>
<body>
<div class="page-meta" data-company="{company}"></div>
{body}
</body>
</html>"""


_CSS = """
@page {
  size: A4;
  margin: 22mm 20mm 20mm 20mm;

  @top-left {
    content: "Research Copilot · Brief";
    font-family: "Helvetica", sans-serif;
    font-size: 8pt;
    color: #888;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  @top-right {
    content: counter(page) " / " counter(pages);
    font-family: "Helvetica", sans-serif;
    font-size: 8pt;
    color: #888;
    letter-spacing: 0.08em;
  }
  @bottom-right {
    content: "Generated by Research Copilot";
    font-family: "Helvetica", sans-serif;
    font-style: italic;
    font-size: 7.5pt;
    color: #aaa;
  }
}

@page :first {
  @top-left { content: ""; }
  @top-right { content: ""; }
  @bottom-right { content: ""; }
}

* { box-sizing: border-box; }

body {
  font-family: "Helvetica Neue", "Helvetica", sans-serif;
  color: #1a1614;
  line-height: 1.55;
  font-size: 10.5pt;
  margin: 0;
}

.cover {
  page-break-after: always;
  padding: 60mm 0 0;
}
.cover .eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 9pt;
  color: #888;
  margin: 0 0 8mm;
}
.cover h1 {
  font-family: "Georgia", serif;
  font-size: 36pt;
  margin: 0 0 6mm;
  color: #1a1614;
  letter-spacing: -0.02em;
  font-weight: 600;
}
.cover .objective {
  font-size: 14pt;
  color: #3a3530;
  max-width: 130mm;
  margin: 0 0 12mm;
}
.cover .meta {
  font-family: "Geist Mono", "Menlo", monospace;
  font-size: 8.5pt;
  color: #8a847e;
  letter-spacing: 0.05em;
}

.rsec {
  page-break-inside: avoid;
  margin-top: 14mm;
}
.rsec h2 {
  display: flex;
  align-items: baseline;
  gap: 10pt;
  margin: 0 0 5mm;
  padding-bottom: 3mm;
  border-bottom: 1px solid #d8d3cc;
  font-family: "Georgia", serif;
  font-size: 18pt;
  font-weight: 600;
}
.rsec h2 .ord {
  font-family: "Geist Mono", "Menlo", monospace;
  font-size: 9.5pt;
  letter-spacing: 0.1em;
  color: #b8866e;
  font-weight: 400;
}
.rsec h2 .t {
  color: #1a1614;
}
.rsec p { margin: 0 0 4mm; }
.rsec .empty {
  color: #8a847e;
  font-style: italic;
}
.rsec .qlist {
  margin: 0 0 4mm 1.4em;
  padding: 0;
}
.rsec .qlist li { margin-bottom: 2mm; }
.rsec .callout {
  border-left: 2px solid #b8866e;
  background: #f7f3ee;
  padding: 4mm 5mm;
  margin: 0 0 4mm;
}
.rsec .cite {
  font-family: "Geist Mono", "Menlo", monospace;
  font-size: 7.5pt;
  color: #b8866e;
  padding: 0 2pt;
}
.rsec .cited {
  margin-top: 4mm;
  font-family: "Geist Mono", "Menlo", monospace;
  font-size: 8pt;
  color: #8a847e;
}
.rsec .cited .cited-label {
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-right: 6pt;
}
.rsec .cited .chip {
  display: inline-block;
  padding: 0 5pt;
  margin-right: 3pt;
  border: 1px solid #d8d3cc;
  border-radius: 999pt;
  color: #3a3530;
}

.sources {
  page-break-before: always;
  padding-top: 10mm;
}
.sources h2 {
  display: flex;
  align-items: baseline;
  gap: 10pt;
  margin: 0 0 6mm;
  padding-bottom: 3mm;
  border-bottom: 1px solid #d8d3cc;
  font-family: "Georgia", serif;
  font-size: 18pt;
  font-weight: 600;
}
.sources h2 .ord {
  font-family: "Geist Mono", "Menlo", monospace;
  font-size: 9.5pt;
  letter-spacing: 0.1em;
  color: #b8866e;
  font-weight: 400;
}
.sources .src-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.sources .src-list li {
  display: flex;
  gap: 6mm;
  padding: 4mm 0;
  border-bottom: 1px solid #efe9e1;
  page-break-inside: avoid;
}
.sources .src-num {
  font-family: "Geist Mono", "Menlo", monospace;
  font-size: 9pt;
  color: #b8866e;
  flex-shrink: 0;
  width: 8mm;
}
.sources .src-body { flex: 1; min-width: 0; }
.sources .src-title {
  font-family: "Georgia", serif;
  font-size: 11.5pt;
  color: #1a1614;
  text-decoration: none;
}
.sources .src-host {
  font-family: "Geist Mono", "Menlo", monospace;
  font-size: 8pt;
  color: #8a847e;
  margin: 1mm 0 0;
  letter-spacing: 0.04em;
}
.sources .src-url {
  font-family: "Geist Mono", "Menlo", monospace;
  font-size: 7.5pt;
  color: #aaa49d;
  margin: 1mm 0 0;
  word-break: break-all;
}
.sources .snippet {
  margin: 2mm 0 0;
  color: #3a3530;
  font-size: 9.5pt;
  font-style: italic;
}
"""
