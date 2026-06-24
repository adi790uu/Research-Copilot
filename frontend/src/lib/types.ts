export type BriefStatus =
  | "pending"
  | "running"
  | "awaiting_clarification"
  | "awaiting_plan_approval"
  | "completed"
  | "failed";

/** Persisted clarification state on a brief. Survives reloads so the
 * clarification card can be re-rendered without a live SSE stream. */
export interface ClarificationState {
  answered: boolean;
  questions: ClarificationQuestion[];
}

export interface Brief {
  id: string;
  company_name: string;
  website: string;
  objective: string;
  status: BriefStatus;
  clarification_question?: ClarificationState | null;
  created_at: string;
  updated_at: string;
}

export interface BriefCreate {
  company_name: string;
  website: string;
  objective: string;
}

export interface BriefPage {
  items: Brief[];
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
  brief_count: number;
  job_count: number;
  recent_briefs: Brief[];
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
  /** The user's pick, once they've answered (persisted on the brief). */
  answer?: string | null;
}

export interface ClarificationAnswer {
  question: string;
  answer: string;
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
  brief_id: string;
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
   * `POST /briefs/{id}/plan/approve` to create it. */
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
// Phase 1 chat turn — POST /briefs/{id}/chat, response body is SSE.
// ---------------------------------------------------------------------------

export type ChatTurnKind = "start" | "answer" | "subscribe";

export interface ChatTurnPayload {
  kind: ChatTurnKind;
  /** Sent as a new HumanMessage. On `start` this carries the labeled intro
   * (company/website/objective); on `answer` the joined clarification text. */
  message?: string;
  /** Set true alongside an `answer` turn that resolves a clarification — the
   * backend clarify gate uses it to advance past the question. */
  clarification_question_answered?: boolean;
  /** The user's pick per question, stored against the brief's clarification. */
  clarification_answers?: ClarificationAnswer[];
}

// ---------------------------------------------------------------------------
// Research job — phase-2 polling. Mirrors job_store._serialize_job.
// ---------------------------------------------------------------------------

export type ResearchJobStatus = "pending" | "running" | "completed" | "failed";

export interface ResearchJob {
  id: string;
  brief_id: string;
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
