import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { ConversationList } from "../components/copilot/ConversationList";
import { ResearchPicker } from "../components/copilot/ResearchPicker";
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

  const chat = useCopilotChat(titleFor);

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden md:flex w-[19rem] shrink-0 flex-col min-h-0 bg-bg-elev/40">
        <ConversationList
          conversations={chat.conversations}
          activeId={chat.activeId}
          onOpen={chat.openConversation}
          onNew={chat.newConversation}
          onDelete={chat.deleteConversation}
        />
        <div className="divider-x mx-4" />
        <ResearchPicker
          researches={researches}
          loading={researchQuery.isLoading}
          selectedIds={chat.selectedBriefIds}
          onToggle={chat.toggleResearch}
        />
      </aside>

      <section className="flex flex-1 flex-col min-w-0 min-h-0">
        <ChatThread
          messages={chat.messages}
          firstName={firstName}
          selectedCount={chat.selectedBriefIds.length}
          onResolveProposal={chat.resolveProposal}
        />
        <Composer
          disabled={chat.sending}
          selectedCount={chat.selectedBriefIds.length}
          onSend={chat.send}
        />
      </section>
    </div>
  );
}
