import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { ApiError, useApi } from "../lib/api";
import { formatRelative, shortId } from "../lib/format";
import type { Brief } from "../lib/types";
import { LoadMore } from "../components/ui/LoadMore";
import { Status, statusLabel, statusTone } from "../components/ui/Pill";

const PAGE_SIZE = 12;

export default function Researches() {
  const api = useApi();

  const query = useInfiniteQuery({
    queryKey: ["briefs", "infinite", PAGE_SIZE],
    queryFn: ({ pageParam }) => api.briefs.list({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  const remaining = Math.max(0, total - items.length);

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto px-6 md:px-10 pt-10 md:pt-14 pb-24">
      <div className="flex items-baseline justify-between gap-6 pb-3 border-b border-rule/15">
        <p className="eyebrow">Researches</p>
        {total > 0 ? (
          <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
            {total} total
          </p>
        ) : null}
      </div>

      <h1
        className="mt-8 font-display text-[2rem] leading-[1.1] text-ink md:text-[2.5rem]"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
      >
        Every brief, in one place.
      </h1>

      <div className="mt-10">
        {query.isLoading ? (
          <SkeletonCards />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <ul className="space-y-3">
              {items.map((brief) => (
                <ResearchCard key={brief.id} brief={brief} />
              ))}
            </ul>
            {query.hasNextPage ? (
              <LoadMore
                onClick={() => query.fetchNextPage()}
                loading={query.isFetchingNextPage}
                remaining={remaining}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ResearchCard({ brief }: { brief: Brief }) {
  return (
    <li>
      <div className="block rounded-2xl bg-bg-elev/60 px-5 py-4">
        <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1">
          <h3 className="text-[1.05rem] font-medium text-ink leading-tight truncate max-w-full">
            {brief.company_name}
          </h3>
          <Status tone={statusTone(brief.status)} pulse={brief.status === "running"}>
            {statusLabel(brief.status)}
          </Status>
          {brief.contact_name ? (
            <span className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/70">
              · meeting {brief.contact_name}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-ink-soft line-clamp-1 max-w-prose">
          {brief.objective}
        </p>
        <div className="mt-2.5 flex items-center gap-3 font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/70">
          <time dateTime={brief.updated_at}>{formatRelative(brief.updated_at)}</time>
          <span>{shortId(brief.id, 6)}</span>
        </div>
      </div>
    </li>
  );
}

function SkeletonCards() {
  return (
    <ul className="space-y-3 animate-pulse" aria-busy>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="rounded-2xl bg-bg-elev/60 px-5 py-4 space-y-2">
          <div className="h-4 w-40 bg-ink/10 rounded-sm" />
          <div className="h-3 w-2/3 bg-ink/5 rounded-sm" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="py-14 text-center">
      <p
        className="font-display italic text-2xl text-ink-soft leading-tight"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
      >
        Your archive is empty.
      </p>
      <p className="text-sm text-ink-faint mt-3 max-w-xs mx-auto leading-relaxed">
        The brief you write today might decide the meeting you walk into tomorrow.
      </p>
      <Link to="/app" className="btn-ghost mt-5 inline-flex">
        Start a research →
      </Link>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof ApiError ? error.message : "Failed to load researches";
  return (
    <div className="py-8 border-l-2 border-bad/60 pl-4">
      <p className="font-mono text-xs uppercase tracking-wider text-bad mb-2">
        Could not reach archive
      </p>
      <p className="text-sm text-ink-soft mb-3">{message}</p>
      <button onClick={onRetry} className="btn-ghost">
        Try again →
      </button>
    </div>
  );
}
