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

export interface User {
  id: string;
  email: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface ActivitySummary {
  user: User;
  session_count: number;
  chat_count: number;
  message_count: number;
  recent_sessions: Session[];
  recent_chats: Chat[];
}

export interface Chat {
  id: string;
  user_id: string;
  session_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatCreate {
  title?: string;
  session_id?: string | null;
}

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface MessageCreate {
  content: string;
}

export interface ChatWithMessages extends Chat {
  messages: Message[];
}
