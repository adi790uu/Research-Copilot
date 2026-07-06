import type {
  CopilotConversation,
  CopilotMessage,
  EditProposal,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY local store — the seam for the Copilot backend.
//
// The chat UI is built against this async, network-shaped interface so the real
// backend drops in by replacing these method bodies with API calls (and the
// streaming reply with an SSE read). Nothing in the hook or the UI needs to
// change. Until then, conversations live in localStorage and replies are an
// honest "preview" stub — no fabricated research facts.
// ─────────────────────────────────────────────────────────────────────────────

const CONVOS_KEY = "rc:copilot:conversations";
const MSGS_KEY = (id: string) => `rc:copilot:messages:${id}`;

const uid = (): string =>
  (crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const now = (): string => new Date().toISOString();

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — non-fatal in preview */
  }
}

function loadConvos(): CopilotConversation[] {
  return read<CopilotConversation[]>(CONVOS_KEY, []);
}

function saveConvos(convos: CopilotConversation[]): void {
  write(CONVOS_KEY, convos);
}

function loadMessages(conversationId: string): CopilotMessage[] {
  return read<CopilotMessage[]>(MSGS_KEY(conversationId), []);
}

function saveMessages(conversationId: string, msgs: CopilotMessage[]): void {
  write(MSGS_KEY(conversationId), msgs);
}

function touch(conversationId: string): void {
  const convos = loadConvos();
  const next = convos.map((c) =>
    c.id === conversationId ? { ...c, updated_at: now() } : c,
  );
  saveConvos(next);
}

function titleFrom(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean || "New chat";
}

export interface StreamHandlers {
  onToken: (chunk: string) => void;
  onProposals?: (proposals: EditProposal[]) => void;
  signal?: AbortSignal;
}

const WRITE_INTENT = /\b(add|update|note|edit|append|revise|change|include|record)\b/i;

export const copilotStore = {
  async listConversations(): Promise<CopilotConversation[]> {
    return loadConvos().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },

  async createConversation(selectedBriefIds: string[] = []): Promise<CopilotConversation> {
    const convo: CopilotConversation = {
      id: uid(),
      title: "New chat",
      selected_brief_ids: selectedBriefIds,
      created_at: now(),
      updated_at: now(),
    };
    saveConvos([convo, ...loadConvos()]);
    return convo;
  },

  async renameConversation(id: string, title: string): Promise<void> {
    saveConvos(loadConvos().map((c) => (c.id === id ? { ...c, title } : c)));
  },

  async deleteConversation(id: string): Promise<void> {
    saveConvos(loadConvos().filter((c) => c.id !== id));
    try {
      localStorage.removeItem(MSGS_KEY(id));
    } catch {
      /* non-fatal */
    }
  },

  async setSelectedResearches(id: string, briefIds: string[]): Promise<void> {
    saveConvos(
      loadConvos().map((c) =>
        c.id === id ? { ...c, selected_brief_ids: briefIds, updated_at: now() } : c,
      ),
    );
  },

  async listMessages(conversationId: string): Promise<CopilotMessage[]> {
    return loadMessages(conversationId);
  },

  /** Persist the user turn, stream a preview assistant reply, persist it, and
   * return the finalized assistant message. Swap the body for an SSE read when
   * the backend lands; the handler shape already matches. */
  async sendMessage(
    conversationId: string,
    text: string,
    researchTitles: string[],
    handlers: StreamHandlers,
  ): Promise<CopilotMessage> {
    const trimmed = text.trim();
    const msgs = loadMessages(conversationId);

    const userMsg: CopilotMessage = {
      id: uid(),
      role: "user",
      content: trimmed,
      created_at: now(),
    };
    msgs.push(userMsg);
    saveMessages(conversationId, msgs);

    const convos = loadConvos();
    const convo = convos.find((c) => c.id === conversationId);
    if (convo && (convo.title === "New chat" || !convo.title)) {
      await this.renameConversation(conversationId, titleFrom(trimmed));
    }
    touch(conversationId);

    const scope = researchTitles.length
      ? researchTitles.join(", ")
      : "no researches selected yet";
    const reply =
      `Preview mode. The Copilot backend isn't connected yet. ` +
      `Once it is, I'll answer this using ${scope}, and cite the underlying sources. ` +
      `You asked: "${trimmed}"`;

    await streamWords(reply, handlers);

    const proposals: EditProposal[] | undefined =
      WRITE_INTENT.test(trimmed) && researchTitles.length
        ? [previewProposal(researchTitles[0])]
        : undefined;
    if (proposals && handlers.onProposals) handlers.onProposals(proposals);

    const assistantMsg: CopilotMessage = {
      id: uid(),
      role: "assistant",
      content: reply,
      proposals,
      created_at: now(),
    };
    const after = loadMessages(conversationId);
    after.push(assistantMsg);
    saveMessages(conversationId, after);
    touch(conversationId);
    return assistantMsg;
  },

  /** Mark a proposed edit applied or discarded. With the backend, "applied"
   * would write the section into the stored report (with version history). */
  async resolveProposal(
    conversationId: string,
    messageId: string,
    proposalId: string,
    status: "applied" | "discarded",
  ): Promise<void> {
    const msgs = loadMessages(conversationId).map((m) =>
      m.id !== messageId
        ? m
        : {
            ...m,
            proposals: m.proposals?.map((p) =>
              p.id === proposalId ? { ...p, status } : p,
            ),
          },
    );
    saveMessages(conversationId, msgs);
  },
};

async function streamWords(text: string, handlers: StreamHandlers): Promise<void> {
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    if (handlers.signal?.aborted) return;
    handlers.onToken(i === 0 ? words[i] : ` ${words[i]}`);
    await delay(18);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function previewProposal(researchTitle: string): EditProposal {
  return {
    id: uid(),
    brief_id: "preview",
    research_title: researchTitle,
    kind: "add",
    heading: "New finding (preview)",
    before: "",
    after:
      "This is a placeholder proposed edit. When the backend is connected, the " +
      "agent will draft grounded, cited section text here for you to confirm.",
    status: "pending",
  };
}
