import { createContext, useContext } from "react";

import type { Brief } from "../../lib/types";

export interface NewResearchContextValue {
  /** Open the modal on a fresh brief form. */
  openNew: () => void;
  /** Reopen a paused brief (awaiting clarification or plan approval). */
  openResume: (brief: Brief) => void;
}

export const NewResearchContext = createContext<NewResearchContextValue | null>(null);

export function useNewResearch(): NewResearchContextValue {
  const ctx = useContext(NewResearchContext);
  if (!ctx) throw new Error("useNewResearch must be used within DashboardLayout");
  return ctx;
}
