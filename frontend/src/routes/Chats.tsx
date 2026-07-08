import { useCallback, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import { useApi } from "../lib/api";
import { formatRelative } from "../lib/format";
import { LoadMore } from "../components/ui/LoadMore";
import type { CopilotConversation } from "../lib/types";

const PAGE_SIZE = 5;
const CHATS_KEY = ["copilot-chats", PAGE_SIZE];

export default function Chats() {
  const navigate = useNavigate();
  const api = useApi();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: CHATS_KEY,
    queryFn: ({ pageParam }) => api.copilot.chats({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  const remaining = Math.max(0, total - items.length);

  const remove = useCallback(
    async (id: string) => {
      if (deletingId) return;
      setDeletingId(id);
      try {
        await api.copilot.deleteChat(id);
        await queryClient.invalidateQueries({ queryKey: CHATS_KEY });
      } finally {
        setDeletingId(null);
      }
    },
    [api, queryClient, deletingId],
  );

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto px-6 md:px-10 pt-10 md:pt-14 pb-24">
      <div className="flex items-baseline justify-between gap-6 pb-3 hairline-b">
        <p className="eyebrow">Chats</p>
        {total > 0 ? (
          <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
            {total} total
          </p>
        ) : null}
      </div>

      <div className="mt-8 flex items-end justify-between gap-6">
        <h1
          className="font-display text-[2rem] leading-[1.1] text-ink md:text-[2.5rem]"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
        >
          Your conversations.
        </h1>
        <button type="button" onClick={() => navigate("/app")} className="btn-ghost shrink-0">
          New chat →
        </button>
      </div>

      <div className="mt-10">
        {query.isLoading ? (
          <SkeletonRows />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <ul className="space-y-3">
              {items.map((c) => (
                <ChatCard
                  key={c.id}
                  conversation={c}
                  deleting={deletingId === c.id}
                  onDelete={() => remove(c.id)}
                />
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

function ChatCard({
  conversation,
  deleting,
  onDelete,
}: {
  conversation: CopilotConversation;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <li className={`group relative transition-opacity ${deleting ? "opacity-50" : ""}`}>
      <Link
        to={`/app?c=${conversation.id}`}
        aria-disabled={deleting}
        className={`block rounded-2xl bg-bg-elev/60 px-5 py-4 transition-colors hover:bg-bg-elev ${
          deleting ? "pointer-events-none" : ""
        }`}
      >
        <h3 className="max-w-full truncate pr-8 text-[1.05rem] font-medium leading-tight text-ink">
          {conversation.title}
        </h3>
        <div className="mt-2.5 flex items-center gap-3 font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/70">
          <time dateTime={conversation.updated_at}>{formatRelative(conversation.updated_at)}</time>
        </div>
      </Link>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        aria-busy={deleting}
        aria-label={deleting ? "Deleting chat" : "Delete chat"}
        title={deleting ? "Deleting…" : "Delete chat"}
        className={`absolute right-4 top-4 transition-colors ${
          deleting
            ? "text-ink-faint"
            : "text-ink-faint/0 group-hover:text-ink-faint/70 hover:!text-bad"
        }`}
      >
        {deleting ? <Spinner /> : <TrashIcon />}
      </button>
    </li>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2} opacity={0.25} />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="py-14 text-center">
      <p
        className="font-display italic text-2xl leading-tight text-ink-soft"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
      >
        No conversations yet.
      </p>
      <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-ink-faint">
        Open the Copilot, pick a research or two, and start asking.
      </p>
      <Link to="/app" className="btn-ghost mt-5 inline-flex">
        Open Copilot →
      </Link>
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className="space-y-3 animate-pulse" aria-busy>
      {[0, 1, 2].map((i) => (
        <li key={i} className="space-y-2 rounded-2xl bg-bg-elev/60 px-5 py-4">
          <div className="h-4 w-52 rounded-sm bg-ink/10" />
          <div className="h-3 w-32 rounded-sm bg-ink/5" />
        </li>
      ))}
    </ul>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
    </svg>
  );
}
