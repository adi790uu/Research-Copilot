import type { Report, ReportSection, Source } from "../../lib/types";

const SECTIONS: Array<{ key: keyof Report["content"]; eyebrow: string; title: string }> = [
  { key: "company_overview", eyebrow: "01", title: "Company overview" },
  { key: "products_and_services", eyebrow: "02", title: "Products & services" },
  { key: "target_customers", eyebrow: "03", title: "Target customers" },
  { key: "business_signals", eyebrow: "04", title: "Business signals" },
  { key: "risks_and_challenges", eyebrow: "05", title: "Risks & challenges" },
  { key: "discovery_questions", eyebrow: "06", title: "Discovery questions" },
  { key: "outreach_strategy", eyebrow: "07", title: "Outreach strategy" },
  { key: "unknowns", eyebrow: "08", title: "Unknowns" },
];

export function ReportView({ report }: { report: Report }) {
  const sourcesById = new Map(report.content.sources.map((s) => [s.id, s]));
  return (
    <div className="space-y-12">
      {SECTIONS.map(({ key, eyebrow, title }) => {
        const section = report.content[key] as ReportSection | undefined;
        if (!section || !section.content) return null;
        return (
          <article key={key as string}>
            <header className="flex items-baseline gap-3 mb-3">
              <span className="font-mono tabular-nums text-xs text-ink-faint/70">{eyebrow}</span>
              <h3 className="font-display text-lg italic text-ink"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80, "WONK" 1' }}
              >
                {title}
              </h3>
            </header>
            <div className="text-sm text-ink-soft leading-relaxed max-w-prose whitespace-pre-line">
              {section.content}
            </div>
            {section.source_ids.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                {section.source_ids.map((sid) => {
                  const s = sourcesById.get(sid);
                  if (!s) return null;
                  return (
                    <a
                      key={sid}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-faint hover:text-ink transition-colors"
                      title={s.title}
                    >
                      [{sid.replace(/^src_/, "")}]
                    </a>
                  );
                })}
              </div>
            )}
          </article>
        );
      })}

      {report.content.sources.length > 0 && (
        <section>
          <header className="flex items-baseline gap-3 mb-3">
            <span className="font-mono tabular-nums text-xs text-ink-faint/70">09</span>
            <h3 className="font-display text-lg italic text-ink"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80, "WONK" 1' }}
            >
              Sources
            </h3>
          </header>
          <ol className="space-y-2">
            {report.content.sources.map((s: Source) => (
              <li key={s.id} className="text-sm">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink hover:underline"
                >
                  {s.title || s.url}
                </a>
                <span className="ml-2 font-mono text-[0.6875rem] uppercase tracking-wider text-ink-faint/70">
                  [{s.id.replace(/^src_/, "")}]
                </span>
                {s.snippet && (
                  <p className="text-xs text-ink-faint mt-1 max-w-prose">{s.snippet}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
