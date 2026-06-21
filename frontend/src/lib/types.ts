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

export interface SessionPage {
  items: Session[];
  total: number;
  limit: number;
  offset: number;
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
  job_count: number;
  recent_sessions: Session[];
}

// ---------------------------------------------------------------------------
// Workflow events (phase 1 only) — mirrors backend app/domain/events.py.
// Phase 2 progress is polled from /jobs/{id} rather than streamed.
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

export interface ResearchSubtopic {
  title: string;
  description: string;
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
  /** Set only on legacy auto-spawn runs. In the current flow the plan
   * pauses for human approval and no job exists yet — the frontend calls
   * `POST /sessions/{id}/plan/approve` to create it. */
  job_id?: string | null;
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
  | RunFailedEvent;

/** Which Tavily-backed tool produced this source. `null` for legacy rows
 * where the type wasn't recorded. */
export type SourceType = "company_site" | "web";

export interface Source {
  id: string;
  url: string;
  title: string;
  snippet: string | null;
  /** Optional section hint so the Sources tab can group by subtopic. */
  section?: ResearchReportSection | null;
  /** Tool channel that found this source. Drives the Sources-tab grouping. */
  type?: SourceType | null;
}

// ---------------------------------------------------------------------------
// Structured 8-section report (mirrors backend `app/domain/report.py`).
// `ResearchJob.final_report` carries the JSON-encoded form of this.
// ---------------------------------------------------------------------------

export type ResearchReportSection =
  | "company_overview"
  | "products_and_services"
  | "target_customers"
  | "business_signals"
  | "risks_and_challenges"
  | "discovery_questions"
  | "outreach_strategy"
  | "unknowns";

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

// ---------------------------------------------------------------------------
// Phase 1 chat turn — POST /sessions/{id}/chat, response body is SSE.
// ---------------------------------------------------------------------------

export type ChatTurnKind = "start" | "answer" | "subscribe";

export interface ChatTurnPayload {
  kind: ChatTurnKind;
  /** Required when kind === "answer". Free-form text appended as a new
   * HumanMessage (typically a joined list of clarification answers). */
  message?: string;
}

// ---------------------------------------------------------------------------
// Research job — phase-2 polling. Mirrors job_store._serialize_job.
// ---------------------------------------------------------------------------

export type ResearchJobStatus = "pending" | "running" | "completed" | "failed";

export interface ResearchJob {
  id: string;
  session_id: string;
  user_id: string;
  status: ResearchJobStatus;
  research_plan: string | null;
  final_report: string | null;
  sources: Source[];
  report_pdf_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchJobEvent {
  event_type: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface ResearcherResult {
  topic: string;
  summary: string;
  sources: Source[];
  created_at: string;
}

export interface ResearchTask {
  id: string;
  title: string;
  description: string;
  status: "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Follow-up chat (post-report). One row per persisted turn.
// ---------------------------------------------------------------------------

export type FollowupRole = "user" | "assistant";

export interface FollowupMessage {
  id: string;
  role: FollowupRole;
  content: string;
  created_at: string;
}
