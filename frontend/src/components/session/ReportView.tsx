import { useMemo } from "react";

import type {
  ReportContent,
  ReportSection,
  ResearchJob,
  Source,
} from "../../lib/types";

interface Props {
  job: ResearchJob;
}

const CITATION_RE = /\[([a-zA-Z0-9_,\s-]+)\]/g;

/**
 * Renders a `ResearchJob`'s `final_report` (JSON-encoded `ReportContent`)
 * as an editorial brief with dynamically-chosen sections. Falls back to a
 * "report payload corrupt" notice if the JSON can't be parsed.
 */
export function ReportView({ job }: Props) {
  const parsed = useMemo<ReportContent | null>(() => {
    if (!job.final_report) return null;
    try {
      const obj = JSON.parse(job.final_report) as ReportContent;
      if (obj && typeof obj === "object" && Array.isArray(obj.sections)) return obj;
      return null;
    } catch {
      return null;
    }
  }, [job.final_report]);

  const srcIndex = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    (parsed?.sources ?? []).forEach((s, i) => map.set(s.id, i + 1));
    return map;
  }, [parsed?.sources]);

  if (!job.final_report) {
    return (
      <p className="text-sm italic text-ink-faint">
        Report not generated yet.
      </p>
    );
  }

  if (!parsed) {
    return (
      <div className="rounded-sm border border-bad/25 bg-bad/5 px-4 py-3">
        <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-bad">
          Report payload corrupt
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          The job stored a final_report value we couldn't parse as
          ReportContent. Re-run research or check the backend logs.
        </p>
      </div>
    );
  }

  return (
    <article className="space-y-10">
      <header className="space-y-1">
        <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
          Brief
        </p>
        <p className="text-xs text-ink-faint">
          {parsed.sections.length}{" "}
          {parsed.sections.length === 1 ? "section" : "sections"} ·{" "}
          {parsed.sources.length}{" "}
          {parsed.sources.length === 1 ? "source" : "sources"}
        </p>
      </header>

      {parsed.summary.trim() ? (
        <section className="space-y-3">
          <h2 className="flex items-baseline gap-3 border-b border-rule/15 pb-2">
            <span className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-accent">
              00
            </span>
            <span className="font-serif text-2xl text-ink">Summary</span>
          </h2>
          <div className="border-l-2 border-accent/40 bg-accent/5 px-4 py-3">
            <Paragraphs text={parsed.summary.trim()} srcIndex={srcIndex} />
          </div>
        </section>
      ) : null}

      {parsed.sections.map((section, i) => (
        <SectionBlock
          key={i}
          ordinal={String(i + 1).padStart(2, "0")}
          section={section}
          srcIndex={srcIndex}
        />
      ))}

      <SourcesList sources={parsed.sources} nextOrdinal={parsed.sections.length + 1} />
    </article>
  );
}

function SectionBlock({
  ordinal,
  section,
  srcIndex,
}: {
  ordinal: string;
  section: ReportSection;
  srcIndex: Map<string, number>;
}) {
  const body = (section.content || "").trim();

  return (
    <section className="space-y-3">
      <h2 className="flex items-baseline gap-3 border-b border-rule/15 pb-2">
        <span className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-accent">
          {ordinal}
        </span>
        <span className="font-serif text-2xl text-ink">{section.heading}</span>
      </h2>

      {body.length === 0 ? (
        <p className="text-sm italic text-ink-faint">
          No content surfaced for this section.
        </p>
      ) : (
        <Paragraphs text={body} srcIndex={srcIndex} />
      )}

      {section.source_ids.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
          <span>Cited</span>
          {section.source_ids
            .filter((sid) => srcIndex.has(sid))
            .map((sid) => (
              <span
                key={sid}
                className="rounded-full border border-rule/20 bg-bg px-2 py-0.5 text-ink-soft"
              >
                {String(srcIndex.get(sid)).padStart(2, "0")}
              </span>
            ))}
        </p>
      )}
    </section>
  );
}

function Paragraphs({
  text,
  srcIndex,
}: {
  text: string;
  srcIndex: Map<string, number>;
}) {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink-soft">
      {paras.map((p, i) => (
        <p key={i}>
          <Cited text={p} srcIndex={srcIndex} />
        </p>
      ))}
    </div>
  );
}

function Cited({
  text,
  srcIndex,
}: {
  text: string;
  srcIndex: Map<string, number>;
}) {
  const parts: (string | { ids: number[] })[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION_RE)) {
    if (m.index === undefined) continue;
    parts.push(text.slice(last, m.index));
    const ids = m[1]
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const known = ids
      .map((sid) => srcIndex.get(sid))
      .filter((n): n is number => typeof n === "number");
    if (known.length > 0) {
      parts.push({ ids: known });
    } else {
      parts.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <sup
            key={i}
            className="ml-0.5 font-mono text-[0.6875rem] text-accent"
          >
            [{p.ids.map((n) => String(n).padStart(2, "0")).join(",")}]
          </sup>
        )
      )}
    </>
  );
}

function SourcesList({ sources, nextOrdinal }: { sources: Source[]; nextOrdinal: number }) {
  if (sources.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="flex items-baseline gap-3 border-b border-rule/15 pb-2">
        <span className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-accent">
          {String(nextOrdinal).padStart(2, "0")}
        </span>
        <span className="font-serif text-2xl text-ink">Sources</span>
      </h2>
      <ol className="space-y-3 text-sm">
        {sources.map((s, idx) => (
          <li
            key={s.id ?? s.url ?? idx}
            className="flex gap-4 border-b border-rule/10 pb-3 last:border-b-0"
          >
            <span className="w-8 shrink-0 font-mono text-xs text-ink-faint">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-serif text-base text-ink hover:text-accent"
              >
                {s.title || s.url}
              </a>
              <p className="mt-1 font-mono text-[0.6875rem] text-ink-faint break-all">
                {s.url}
              </p>
              {s.snippet ? (
                <p className="mt-1 text-xs italic text-ink-soft">{s.snippet}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
