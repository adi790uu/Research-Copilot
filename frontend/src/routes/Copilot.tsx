import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { ChatThread } from "../components/copilot/ChatThread";
import { Composer } from "../components/copilot/Composer";
import { useCopilotChat } from "../hooks/useCopilotChat";
import { useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Brief } from "../lib/types";

export default function Copilot() {
  const api = useApi();
  const { session } = useAuth();
  const firstName = session?.user.email.split("@")[0] ?? null;

  const [params, setParams] = useSearchParams();
  const conversationId = params.get("c");
  const setActive = useCallback(
    (id: string | null) => setParams(id ? { c: id } : {}, { replace: true }),
    [setParams],
  );

  const researchQuery = useQuery({
    queryKey: ["briefs", { limit: 50, offset: 0 }],
    queryFn: () => api.briefs.list({ limit: 50, offset: 0 }),
  });
  const researches = useMemo<Brief[]>(
    () => researchQuery.data?.items ?? [],
    [researchQuery.data],
  );

  const titleFor = useCallback(
    (briefId: string) =>
      researches.find((b) => b.id === briefId)?.company_name ?? "a research",
    [researches],
  );

  const chat = useCopilotChat(titleFor, { conversationId, onActiveChange: setActive });

  return (
    <section className="flex h-full min-h-0 flex-col">
      <ChatHeader
        title={chat.messages.length > 0 ? chat.activeTitle : "New chat"}
        canReset={chat.activeId !== null || chat.messages.length > 0}
        onNew={() => setActive(null)}
      />
      <ChatThread
        messages={chat.messages}
        firstName={firstName}
        selectedCount={chat.selectedBriefIds.length}
        onResolveProposal={chat.resolveProposal}
      />
      <Composer
        disabled={chat.sending}
        researches={researches}
        researchesLoading={researchQuery.isLoading}
        selectedIds={chat.selectedBriefIds}
        onToggleResearch={chat.toggleResearch}
        onSend={chat.send}
      />
    </section>
  );
}

function ChatHeader({
  title,
  canReset,
  onNew,
}: {
  title: string;
  canReset: boolean;
  onNew: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 px-6 hairline-b">
      <p className="truncate text-sm text-ink-soft">{title}</p>
      {canReset ? (
        <button
          type="button"
          onClick={onNew}
          className="group inline-flex shrink-0 items-center gap-1.5 text-ink-faint transition-colors hover:text-ink"
          title="New chat"
        >
          <svg
            viewBox="0 0 24 24"
            width={13}
            height={13}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="font-mono text-[0.625rem] uppercase tracking-eyebrow">New chat</span>
        </button>
      ) : null}
    </div>
  );
}
