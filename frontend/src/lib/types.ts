export type SessionStatus =
  | "pending"
  | "running"
  | "awaiting_clarification"
  | "awaiting_plan_approval"
  | "completed"
  | "failed";

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

// ---------------------------------------------------------------------------
// Workflow events + report (mirrors backend app/domain/events.py + report.py).
// ---------------------------------------------------------------------------

export type WorkflowNode =
  | "clarify_with_user"
  | "write_research_brief"
  | "create_research_plan"
  | "research_supervisor"
  | "final_report_generation";

export interface ClarificationQuestion {
  question: string;
  suggested_answers: string[];
}

export type ResearchSubtopicTools = "company_site" | "web" | "both";
export type ResearchSubtopicPriority = "depth" | "breadth";
export type ResearchReportSection =
  | "company_overview"
  | "products_and_services"
  | "target_customers"
  | "business_signals"
  | "risks_and_challenges"
  | "discovery_questions"
  | "outreach_strategy"
  | "unknowns";

export interface ResearchSubtopic {
  title: string;
  description: string;
  section: ResearchReportSection;
  tools: ResearchSubtopicTools;
  priority: ResearchSubtopicPriority;
}

export interface ResearchPlan {
  user_message: string;
  strategy_summary: string;
  subtopics: ResearchSubtopic[];
}

interface BaseEvent {
  session_id: string;
  at: string;
}

export interface RunStartedEvent extends BaseEvent {
  type: "run_started";
}
export interface NodeStartedEvent extends BaseEvent {
  type: "node_started";
  node: WorkflowNode;
  attempt: number;
}
export interface NodeCompletedEvent extends BaseEvent {
  type: "node_completed";
  node: WorkflowNode;
  attempt: number;
  duration_ms: number;
}
export interface NodeFailedEvent extends BaseEvent {
  type: "node_failed";
  node: WorkflowNode;
  attempt: number;
  message: string;
}
export interface ClarificationRequestedEvent extends BaseEvent {
  type: "clarification_requested";
  questions: ClarificationQuestion[];
}
export interface PlanReadyEvent extends BaseEvent {
  type: "plan_ready";
  plan: ResearchPlan;
}
export interface ReportReadyEvent extends BaseEvent {
  type: "report_ready";
  report_id: string;
}
export interface RunFailedEvent extends BaseEvent {
  type: "run_failed";
  message: string;
}

export type WorkflowEvent =
  | RunStartedEvent
  | NodeStartedEvent
  | NodeCompletedEvent
  | NodeFailedEvent
  | ClarificationRequestedEvent
  | PlanReadyEvent
  | ReportReadyEvent
  | RunFailedEvent;

export interface Source {
  id: string;
  url: string;
  title: string;
  snippet: string | null;
}

export interface ReportSection {
  content: string;
  source_ids: string[];
}

export interface ReportContent {
  company_overview: ReportSection;
  products_and_services: ReportSection;
  target_customers: ReportSection;
  business_signals: ReportSection;
  risks_and_challenges: ReportSection;
  discovery_questions: ReportSection;
  outreach_strategy: ReportSection;
  unknowns: ReportSection;
  sources: Source[];
}

export interface Report {
  id: string;
  session_id: string;
  content: ReportContent;
  created_at: string;
}
