import type { ReactNode } from "react";

import type { Report, ReportContent, ReportSection, Source } from "../../lib/types";
import { SourceCitation } from "./SourceCitation";

type SectionKey = keyof ReportContent;

interface SectionMeta {
  key: Exclude<SectionKey, "sources">;
  ordinal: string;
  title: string;
  /** How to render the section body when content is present. */
  render: "prose" | "ordered-list" | "callout";
  /** Shown when the section is empty or thin. */
  emptyHint: string;
}

const SECTIONS: SectionMeta[] = [
  {
    key: "company_overview",
    ordinal: "01",
    title: "Company overview",
    render: "prose",
    emptyHint:
      "No overview could be drafted from the available sources. Re-run with a clearer objective or website.",
  },
  {
    key: "products_and_services",
    ordinal: "02",
    title: "Products & services",
    render: "prose",
    emptyHint: "No product or service details surfaced in this pass.",
  },
  {
    key: "target_customers",
    ordinal: "03",
    title: "Target customers",
    render: "prose",
    emptyHint: "No customer or segment information was found.",
  },
  {
    key: "business_signals",
    ordinal: "04",
    title: "Business signals",
    render: "prose",
    emptyHint:
      "No recent signals — funding, hiring, launches — surfaced for this company.",
  },
  {
    key: "risks_and_challenges",
    ordinal: "05",
    title: "Risks & challenges",
    render: "prose",
    emptyHint: "No risks or challenges were surfaced.",
  },
  {
    key: "discovery_questions",
    ordinal: "06",
    title: "Discovery questions",
    render: "ordered-list",
    emptyHint: "No discovery questions drafted yet.",
  },
  {
    key: "outreach_strategy",
    ordinal: "07",
    title: "Outreach strategy",
    render: "prose",
    emptyHint: "No outreach strategy could be drafted from this brief.",
  },
  {
    key: "unknowns",
    ordinal: "08",
    title: "Unknowns",
    render: "callout",
    emptyHint: "Nothing flagged — every required section was covered.",
  },
];

export function ReportView({ report }: { report: Report }) {
  const sourcesById = new Map(report.content.sources.map((s) => [s.id, s]));
  const sourceIndexById = new Map(
    report.content.sources.map((s, i) => [s.id, i + 1])
  );

  return (
    <div className="space-y-16 text-ink">
      {SECTIONS.map((meta) => {
        const section = report.content[meta.key];
        return (
          <SectionBlock
            key={meta.key}
            meta={meta}
            section={section}
            sourcesById={sourcesById}
            sourceIndexById={sourceIndexById}
          />
        );
      })}

      <SourcesBlock sources={report.content.sources} />
    </div>
  );
}

function SectionBlock({
  meta,
  section,
  sourcesById,
  sourceIndexById,
}: {
  meta: SectionMeta;
  section: ReportSection | undefined;
  sourcesById: Map<string, Source>;
  sourceIndexById: Map<string, number>;
}) {
  const empty = !section || !section.content.trim();
  return (
    <article aria-labelledby={`section-${meta.key}`}>
      <SectionHead ordinal={meta.ordinal} title={meta.title} id={`section-${meta.key}`} />

      {empty ? (
        <EmptyHint
          tone={meta.key === "unknowns" ? "good" : "neutral"}
          message={meta.emptyHint}
        />
      ) : (
        <SectionBody meta={meta} section={section!} />
      )}

      {!empty && section && section.source_ids.length > 0 && (
        <CitationStrip
          sourceIds={section.source_ids}
          sourcesById={sourcesById}
          sourceIndexById={sourceIndexById}
        />
      )}
    </article>
  );
}

function SectionHead({
  ordinal,
  title,
  id,
}: {
  ordinal: string;
  title: string;
  id: string;
}) {
  return (
    <header className="flex items-baseline gap-4 mb-5 pb-3 rule-b">
      <span className="font-mono tabular-nums text-xs text-ink-faint/70 tracking-wider">
        {ordinal}
      </span>
      <h3
        id={id}
        className="font-display text-2xl italic text-ink leading-tight"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80, "WONK" 1' }}
      >
        {title}
      </h3>
    </header>
  );
}

function SectionBody({
  meta,
  section,
}: {
  meta: SectionMeta;
  section: ReportSection;
}) {
  const content = section.content.trim();

  if (meta.render === "ordered-list") {
    const items = splitIntoQuestions(content);
    if (items.length <= 1) {
      // Fall through to prose if we can't split — better that than mis-formatting.
      return <Prose>{content}</Prose>;
    }
    return (
      <ol className="space-y-4 list-none max-w-[68ch]">
        {items.map((q, i) => (
          <li
            key={i}
            className="flex items-baseline gap-4 text-[15px] text-ink/90 leading-[1.7]"
          >
            <span className="font-mono tabular-nums text-[0.6875rem] text-ink-faint/70 mt-1 shrink-0">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{q}</span>
          </li>
        ))}
      </ol>
    );
  }

  if (meta.render === "callout") {
    return (
      <div className="border-l-2 border-warn/50 pl-5 py-2 max-w-[68ch]">
        <Prose className="text-ink-soft italic">{content}</Prose>
      </div>
    );
  }

  return <Prose>{content}</Prose>;
}

function Prose({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  // Reading-tuned: larger body, generous leading, comfortable measure.
  return (
    <div
      className={`text-[15px] text-ink/90 leading-[1.75] max-w-[68ch] whitespace-pre-line ${className}`}
    >
      {children}
    </div>
  );
}

function EmptyHint({
  tone,
  message,
}: {
  tone: "neutral" | "good";
  message: string;
}) {
  const borderColor = tone === "good" ? "border-good/40" : "border-rule/20";
  const dotColor = tone === "good" ? "bg-good" : "bg-ink-faint/40";
  return (
    <div className={`flex items-start gap-3 border-l-2 ${borderColor} pl-4 py-1`}>
      <span className={`mt-1.5 h-[5px] w-[5px] rounded-full ${dotColor}`} aria-hidden />
      <p className="text-sm text-ink-faint italic max-w-prose">{message}</p>
    </div>
  );
}

function CitationStrip({
  sourceIds,
  sourcesById,
  sourceIndexById,
}: {
  sourceIds: string[];
  sourcesById: Map<string, Source>;
  sourceIndexById: Map<string, number>;
}) {
  const cited = sourceIds
    .map((id) => sourcesById.get(id))
    .filter((s): s is Source => Boolean(s));
  if (cited.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/70 mr-1">
        Cited
      </span>
      {cited.map((s) => (
        <SourceCitation key={s.id} source={s} index={sourceIndexById.get(s.id)} />
      ))}
    </div>
  );
}

function SourcesBlock({ sources }: { sources: Source[] }) {
  if (sources.length === 0) {
    return (
      <article>
        <SectionHead ordinal="09" title="Sources" id="section-sources" />
        <EmptyHint
          tone="neutral"
          message="No sources were retained for this brief."
        />
      </article>
    );
  }
  return (
    <article>
      <SectionHead ordinal="09" title="Sources" id="section-sources" />
      <ol className="space-y-4">
        {sources.map((s, i) => (
          <li key={s.id} className="flex items-baseline gap-3">
            <span className="font-mono tabular-nums text-[0.6875rem] text-ink-faint/70 shrink-0">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-ink hover:underline underline-offset-2 break-words"
              >
                {s.title || s.url}
              </a>
              <p className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/70 mt-0.5 truncate">
                {prettyHost(s.url)}
              </p>
              {s.snippet && (
                <p className="text-xs text-ink-faint mt-1.5 max-w-prose leading-relaxed line-clamp-3">
                  {s.snippet}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

/**
 * Split a synthesizer-emitted "discovery questions" block into individual
 * questions. The LLM sometimes returns a numbered list, sometimes prose with
 * `?` delimiters — handle both.
 */
function splitIntoQuestions(text: string): string[] {
  // Prefer explicit numbered lines: "1." / "1)" / "- "
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;

  // Fall back to splitting on question marks.
  const parts = text
    .split(/\?\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => (p.endsWith("?") ? p : `${p}?`));
}

function prettyHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Pre-allocated skeleton matching the report's section rhythm. Use while the
 * workflow is running so the page doesn't reflow when the report arrives.
 */
export function ReportSkeleton() {
  return (
    <div className="space-y-14" aria-busy>
      {[...SECTIONS, { ordinal: "09", title: "Sources" }].map((meta, i) => (
        <article key={i}>
          <header className="flex items-baseline gap-3 mb-4 pb-2 rule-b">
            <span className="font-mono tabular-nums text-xs text-ink-faint/70">
              {meta.ordinal}
            </span>
            <h3
              className="font-display text-xl italic text-ink-faint/60"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80, "WONK" 1' }}
            >
              {meta.title}
            </h3>
          </header>
          <div className="animate-pulse space-y-2 max-w-prose">
            <div className="h-3 w-full bg-ink/8 rounded-sm" />
            <div className="h-3 w-11/12 bg-ink/6 rounded-sm" />
            <div className="h-3 w-3/4 bg-ink/5 rounded-sm" />
          </div>
        </article>
      ))}
    </div>
  );
}
