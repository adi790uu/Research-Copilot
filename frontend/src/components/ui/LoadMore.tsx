/**
 * Shared "Load more" control for offset-paginated lists. Shows how many items
 * remain and a loading state while the next page is in flight.
 */
export function LoadMore({
  onClick,
  loading,
  remaining,
}: {
  onClick: () => void;
  loading: boolean;
  remaining: number;
}) {
  return (
    <div className="mt-8 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        aria-busy={loading}
        className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
      >
        {loading ? "Loading…" : `Load more (${remaining})`}
      </button>
    </div>
  );
}
