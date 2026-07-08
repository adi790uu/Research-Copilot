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

/** Result of the People Data Labs lookup for a brief's meeting contact.
 * `status: "resolved"` is a confident match; "unresolved" means no candidate
 * cleared the confidence threshold (never shown as if it were a match);
 * "skipped" means no contact was given, or resolution isn't configured. */
export interface ContactResolution {
  status: "resolved" | "unresolved" | "skipped";
  source?: string | null;
  likelihood?: number | null;
  name?: string | null;
  title?: string | null;
  company?: string | null;
  company_website?: string | null;
  linkedin_url?: string | null;
  location?: string | null;
}

export interface Brief {
  id: string;
  company_name: string;
  website: string;
  objective: string;
  status: BriefStatus;
  clarification_question?: ClarificationState | null;
  /** The generated plan, persisted once ready so an awaiting-approval brief can
   * be reopened at the plan step without an extra fetch. */
  research_plan?: ResearchPlan | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_resolution?: ContactResolution | null;
  created_at: string;
  updated_at: string;
}

export interface BriefCreate {
  company_name: string;
  website: string;
  objective: string;
  contact_name?: string;
  contact_email?: string;
}

export interface BriefPage {
  items: Brief[];
  total: number;
  limit: number;
  offset: number;
}

/** The seller's own company profile, reused across researches to build pitches. */
export interface CompanyContext {
  what_you_sell: string;
  value_props: string;
  icp: string;
  differentiators: string;
  proof_points: string;
  notes: string;
}

export interface User {
  id: string;
  email: string | null;
  company_context: CompanyContext | null;
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

/** A research mandate (mirrors backend `ResearchPlan`). The supervisor owns
 * dynamic decomposition; coverage_angles are non-binding seeds. */
export interface ResearchPlan {
  research_goal: string;
  guidance: string;
  coverage_angles: string[];
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

/** Which tool/channel produced this source (kept in sync with the worker's
 * SourceType). `null` for legacy rows where the type wasn't recorded. */
export type SourceType =
  | "company_site"
  | "web"
  | "linkedin"
  | "twitter"
  | "reddit"
  | "social";

export interface Source {
  id: string;
  url: string;
  title: string;
  snippet: string | null;
  /** Optional section hint so the Sources tab can group by subtopic. */
  section?: string | null;
  /** Tool channel that found this source. Drives the Sources-tab grouping. */
  type?: SourceType | null;
}

// ---------------------------------------------------------------------------
// Dynamically-structured report (mirrors backend `app/domain/report.py`).
// The writer chooses the sections; `ResearchJob.company_report` carries this.
// ---------------------------------------------------------------------------

export interface ReportSection {
  heading: string;
  content: string;
  source_ids: string[];
}

export interface ReportContent {
  /** Direct answer to the user's objective; the headline payoff. */
  answer: string;
  summary: string;
  sections: ReportSection[];
  sources: Source[];
}

/** The named meeting contact. `verified` is false when identity could not be
 * confidently tied to the target company (a namesake is never attributed). */
export interface PersonReport {
  verified: boolean;
  headline: string;
  summary: string;
  sections: ReportSection[];
  sources: Source[];
}

export interface PitchTalkingPoint {
  point: string;
  rationale: string;
}

export interface PitchObjection {
  objection: string;
  response: string;
}

/** Sales pitch built from the research + the seller's company context.
 * Present only when the seller has filled in their company context. */
export interface Pitch {
  headline: string;
  why_now: string;
  talking_points: PitchTalkingPoint[];
  opening_message: string;
  objections: PitchObjection[];
}

// ---------------------------------------------------------------------------
// Phase 1 chat turn — POST /briefs/{id}/chat, response body is SSE.
// ---------------------------------------------------------------------------

export type ChatTurnKind = "start" | "answer";

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
  /** Factual company research (carries the summary + sources). */
  company_report: ReportContent | null;
  /** Named meeting contact; null when the brief has no contact. */
  person_report: PersonReport | null;
  /** Sales pitch; null when the seller has no company context. */
  pitch: Pitch | null;
  created_at: string;
  updated_at: string;
}

/** One research angle, for the running-card progress line. */
export interface ProgressTask {
  title: string;
  status: "running" | "completed" | "failed";
}

/** GET /briefs/{id}/progress — latest job status + its tasks (polled while a
 * research is running). */
export interface ResearchProgress {
  status: ResearchJobStatus;
  tasks: ProgressTask[];
}

// ---------------------------------------------------------------------------
// Copilot: persistent chat threads that operate over one or more researches.
// ---------------------------------------------------------------------------

export type CopilotRole = "user" | "assistant";

/** A proposed edit to a research report, awaiting the user's confirmation. */
export interface EditProposal {
  id: string;
  brief_id: string;
  /** Research this edit targets, for display. */
  research_title: string;
  /** "replace" an existing section, or "add" a new one. */
  kind: "replace" | "add";
  heading: string;
  /** Current section text (empty for an "add"). */
  before: string;
  /** Proposed section text. */
  after: string;
  status: "pending" | "applied" | "discarded";
}

export interface CopilotMessage {
  id: string;
  role: CopilotRole;
  content: string;
  proposals?: EditProposal[];
  created_at: string;
}

/** A saved chat thread. The researches to ground on are sent fresh with each
 * message (see `CopilotChatRequest`) rather than stored on the thread. */
export interface CopilotConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/** A chat thread with its full message history (GET /copilot/chats/:id). */
export interface CopilotChatDetail extends CopilotConversation {
  messages: CopilotMessage[];
}

/** One page of chat threads (GET /copilot/chats?limit&offset). */
export interface CopilotConversationPage {
  items: CopilotConversation[];
  total: number;
  limit: number;
  offset: number;
}

/** Body for POST /copilot/chat. */
export interface CopilotChatRequest {
  chat_id: string;
  research_ids: string[];
  message: string;
}
