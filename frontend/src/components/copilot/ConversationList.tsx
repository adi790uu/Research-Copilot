import { formatRelative } from "../../lib/format";
import type { CopilotConversation } from "../../lib/types";

export function ConversationList({
  conversations,
  activeId,
  onOpen,
  onNew,
  onDelete,
}: {
  conversations: CopilotConversation[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col" style={{ maxHeight: "45%" }}>
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <p className="eyebrow">Chats</p>
        <button
          type="button"
          onClick={onNew}
          className="group inline-flex items-center gap-1.5 text-ink-faint transition-colors hover:text-ink"
          title="New chat"
        >
          <PlusIcon />
          <span className="font-mono text-[0.625rem] uppercase tracking-eyebrow">New</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <p className="px-3 py-2 text-xs text-ink-faint/80 leading-relaxed">
            No chats yet. Start one below.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => (
              <li key={c.id}>
                <div
                  className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
                    c.id === activeId ? "bg-ink/[0.06]" : "hover:bg-ink/[0.04]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span
                      className={`block truncate text-sm ${
                        c.id === activeId ? "text-ink" : "text-ink-soft"
                      }`}
                    >
                      {c.title}
                    </span>
                    <span className="font-mono text-[0.5625rem] uppercase tracking-wider text-ink-faint/70">
                      {formatRelative(c.updated_at)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    aria-label="Delete chat"
                    title="Delete chat"
                    className="shrink-0 text-ink-faint/0 transition-colors group-hover:text-ink-faint/70 hover:!text-bad"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
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
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
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
