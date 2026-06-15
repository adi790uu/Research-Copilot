"""Report → HTML → PDF rendering.

WeasyPrint is loaded lazily so an import failure (missing Pango/Cairo libs on
macOS, etc.) doesn't take the rest of the app down — the endpoint surfaces a
clear 503 instead.
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
    """Make WeasyPrint's Pango/Cairo loads work on macOS + Homebrew.

    The dynamic loader can't find Homebrew libs (they're not in /usr/lib or
    the dyld cache), and WeasyPrint asks for them by their *Linux* SONAME
    suffix (e.g. ``gobject-2.0-0``) which doesn't exist on macOS (the file is
    ``libgobject-2.0.dylib``). Both problems are solved by monkey-patching
    ``ctypes.util.find_library`` to fall back to Homebrew paths and to
    normalize the suffix.

    Linux/Docker doesn't need this — once ``libpango-1.0-0``,
    ``libpangoft2-1.0-0``, ``libharfbuzz0b``, and ``libffi`` are apt-installed,
    ``ldconfig``-managed paths cover everything WeasyPrint asks for.
    """
    if platform.system() != "Darwin":
        return

    prefixes = [p for p in ("/opt/homebrew/lib", "/usr/local/lib") if os.path.isdir(p)]
    if not prefixes:
        return

    orig = ctypes.util.find_library
    if getattr(orig, "_rc_patched", False):
        return  # idempotent — survive module re-imports under reloaders

    def _patched(name: str) -> str | None:
        found = orig(name)
        if found is not None:
            return found
        # WeasyPrint asks via cffi for names like "gobject-2.0" or
        # "gobject-2.0-0"; Homebrew installs them as e.g.
        # "libgobject-2.0.dylib" (canonical) and "libgobject-2.0.0.dylib"
        # (versioned). Strip any trailing "-N" SONAME suffix when searching.
        stripped = re.sub(r"-\d+$", "", name)
        attempts = [
            f"lib{name}.dylib",
            f"lib{name}.0.dylib",
            f"lib{stripped}.dylib",
            f"lib{stripped}.0.dylib",
        ]
        for prefix in prefixes:
            for fname in attempts:
                path = os.path.join(prefix, fname)
                if os.path.exists(path):
                    return path
        return None

    _patched._rc_patched = True  # type: ignore[attr-defined]
    ctypes.util.find_library = _patched  # type: ignore[assignment]


_bootstrap_native_libs()


class PDFRenderError(RuntimeError):
    """Raised when WeasyPrint or its native deps can't render."""


_SECTION_LABELS: list[tuple[str, str, str, str]] = [
    # (attr, ordinal, title, render-kind)
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
    """Render the report to a PDF byte string. Raises PDFRenderError if the
    WeasyPrint native stack can't load."""
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
        body_html = (
            '<p class="empty">No content surfaced for this section.</p>'
        )
    elif kind == "list":
        items = _split_questions(body)
        if len(items) > 1:
            lis = "\n".join(
                f"<li>{_render_text(q, src_index)}</li>" for q in items
            )
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
        snippet = (
            f'<p class="snippet">{escape(s.snippet)}</p>'
            if s.snippet
            else ""
        )
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
    """Escape + transform [s1] / [s1,s2] markers into superscript citations."""
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
    # Numbered or bulleted lines first.
    lines = [
        re.sub(r"^\s*(?:\d+[.)]|[-•*])\s*", "", line).strip()
        for line in re.split(r"\n+", text)
    ]
    lines = [line for line in lines if line]
    if len(lines) > 1:
        return lines
    # Fall back to splitting on `?`.
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
  font-family: "Georgia", "Times New Roman", serif;
  font-size: 10.25pt;
  line-height: 1.55;
  color: #1a1614;
  margin: 0;
}

.eyebrow {
  font-family: "Helvetica", sans-serif;
  font-size: 8pt;
  font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #999;
  margin: 0;
}

/* ---------- Cover ---------- */

.cover {
  page-break-after: always;
  padding-top: 34mm;
}
.cover h1 {
  font-family: "Georgia", serif;
  font-size: 40pt;
  font-weight: normal;
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin: 18mm 0 0 0;
  color: #1a1614;
}
.cover .objective {
  font-style: italic;
  font-size: 14pt;
  line-height: 1.4;
  color: #4a3f37;
  margin: 12mm 0 0 0;
  max-width: 135mm;
}
.cover .meta {
  margin: 38mm 0 0 0;
  font-family: "Helvetica", sans-serif;
  font-size: 8pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #888;
  padding-top: 6mm;
  border-top: 0.3pt solid #cfcac1;
  display: inline-block;
  padding-right: 12mm;
}

/* ---------- Body sections ---------- */

.rsec {
  page-break-inside: avoid;
  margin-bottom: 12mm;
}

.rsec h2 {
  font-family: "Georgia", serif;
  font-size: 18pt;
  font-weight: normal;
  font-style: italic;
  color: #1a1614;
  margin: 0 0 5mm 0;
  padding-bottom: 2mm;
  border-bottom: 0.4pt solid #d3cec4;
  display: flex;
  align-items: baseline;
  gap: 7mm;
}
.rsec h2 .ord {
  font-family: "Helvetica", sans-serif;
  font-style: normal;
  font-size: 9pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #b46624;
  flex-shrink: 0;
}
.rsec h2 .t {
  flex: 1;
}

.rsec p {
  margin: 0 0 3.5mm 0;
  text-align: justify;
  hyphens: auto;
}

.rsec .callout {
  border-left: 1pt solid #c89a55;
  padding: 1mm 0 1mm 5mm;
  background: #faf6ec;
  font-style: italic;
  color: #5b4d36;
  margin-bottom: 4mm;
}
.rsec .callout p {
  text-align: left;
}

.rsec ol.qlist {
  margin: 0;
  padding-left: 0;
  list-style: none;
  counter-reset: qitem;
}
.rsec ol.qlist li {
  counter-increment: qitem;
  position: relative;
  padding-left: 11mm;
  margin-bottom: 3mm;
}
.rsec ol.qlist li::before {
  content: counter(qitem, decimal-leading-zero);
  position: absolute;
  left: 0;
  top: 1mm;
  font-family: "Helvetica", sans-serif;
  font-size: 8pt;
  color: #999;
  letter-spacing: 0.1em;
}

.rsec .empty {
  color: #999;
  font-style: italic;
  font-size: 9pt;
}

/* ---------- Inline citations ---------- */

sup.cite {
  font-family: "Helvetica", sans-serif;
  font-size: 6.5pt;
  letter-spacing: 0.05em;
  color: #b46624;
  vertical-align: super;
  line-height: 0;
  padding-left: 0.3mm;
  font-style: normal;
}

.cited {
  margin-top: 4mm;
  font-family: "Helvetica", sans-serif;
  font-size: 8pt;
  color: #999;
  letter-spacing: 0.06em;
}
.cited-label {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  margin-right: 3mm;
  color: #aaa;
  font-size: 7.5pt;
}
.cited .chip {
  display: inline-block;
  margin-right: 1.5mm;
  padding: 0 1.2mm;
  border: 0.3pt solid #d3cec4;
  border-radius: 1pt;
  color: #6b6055;
  font-size: 8pt;
}

/* ---------- Sources ---------- */

.sources {
  page-break-before: always;
  padding-top: 4mm;
}
.sources h2 {
  font-family: "Georgia", serif;
  font-style: italic;
  font-size: 22pt;
  font-weight: normal;
  margin: 0 0 8mm 0;
  padding-bottom: 3mm;
  border-bottom: 0.6pt solid #6b6055;
  display: flex;
  align-items: baseline;
  gap: 7mm;
}
.sources h2 .ord {
  font-family: "Helvetica", sans-serif;
  font-style: normal;
  font-size: 9pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #b46624;
}

.src-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.src-list li {
  display: grid;
  grid-template-columns: 12mm 1fr;
  gap: 4mm;
  padding: 4mm 0;
  border-bottom: 0.3pt solid #e6e1d6;
  page-break-inside: avoid;
}
.src-list li:last-child {
  border-bottom: none;
}
.src-num {
  font-family: "Helvetica", sans-serif;
  font-size: 9pt;
  color: #b46624;
  letter-spacing: 0.1em;
  padding-top: 1pt;
}
.src-title {
  font-size: 10.5pt;
  color: #1a1614;
  text-decoration: none;
  display: block;
  line-height: 1.3;
}
.src-host {
  font-family: "Helvetica", sans-serif;
  font-size: 7.5pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #999;
  margin: 1mm 0 0 0;
}
.src-url {
  font-family: "Courier New", monospace;
  font-size: 7.5pt;
  color: #888;
  margin: 1mm 0 0 0;
  word-break: break-all;
}
.src-list .snippet {
  font-size: 9pt;
  font-style: italic;
  color: #5a5044;
  margin: 2mm 0 0 0;
  line-height: 1.45;
}
"""
