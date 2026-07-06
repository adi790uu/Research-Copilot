import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { copilotStore } from "../lib/copilotStore";
import { formatRelative } from "../lib/format";
import type { CopilotConversation } from "../lib/types";

export default function Chats() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<CopilotConversation[] | null>(null);

  const refresh = useCallback(() => {
    copilotStore.listConversations().then(setConversations);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await copilotStore.deleteConversation(id);
      refresh();
    },
    [refresh],
  );

  const items = conversations ?? [];

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto px-6 md:px-10 pt-10 md:pt-14 pb-24">
      <div className="flex items-baseline justify-between gap-6 pb-3 hairline-b">
        <p className="eyebrow">Chats</p>
        {items.length > 0 ? (
          <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
            {items.length} total
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
        {conversations === null ? (
          <SkeletonRows />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-3">
            {items.map((c) => (
              <ChatCard key={c.id} conversation={c} onDelete={() => remove(c.id)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChatCard({
  conversation,
  onDelete,
}: {
  conversation: CopilotConversation;
  onDelete: () => void;
}) {
  const count = conversation.selected_brief_ids.length;
  return (
    <li className="group relative">
      <Link
        to={`/app?c=${conversation.id}`}
        className="block rounded-2xl bg-bg-elev/60 px-5 py-4 transition-colors hover:bg-bg-elev"
      >
        <h3 className="max-w-full truncate pr-8 text-[1.05rem] font-medium leading-tight text-ink">
          {conversation.title}
        </h3>
        <div className="mt-2.5 flex items-center gap-3 font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/70">
          <time dateTime={conversation.updated_at}>{formatRelative(conversation.updated_at)}</time>
          <span>
            {count > 0
              ? `${count} ${count === 1 ? "research" : "researches"} in context`
              : "no research selected"}
          </span>
        </div>
      </Link>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete chat"
        title="Delete chat"
        className="absolute right-4 top-4 text-ink-faint/0 transition-colors group-hover:text-ink-faint/70 hover:!text-bad"
      >
        <TrashIcon />
      </button>
    </li>
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
