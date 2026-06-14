export type SessionStatus = "pending" | "running" | "completed" | "failed";

export interface Session {
  id: string;
  company_name: string;
  website: string;
  objective: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}

export interface SessionCreate {
  company_name: string;
  website: string;
  objective: string;
}
