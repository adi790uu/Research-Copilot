import { useCallback, useEffect, useRef, useState } from "react";

import { useApi } from "../lib/api";
import { readWorkflowSSE } from "../lib/sse";
import type {
  Brief,
  BriefCreate,
  ClarificationAnswer,
  ClarificationQuestion,
  ResearchPlan,
} from "../lib/types";

/** Wizard steps, in the order the user moves through them. `running` covers both
 * the initial phase-1 run and the resume after answering clarification. */
export type WizardStep = "form" | "running" | "clarify" | "plan" | "error";

interface State {
  step: WizardStep;
  briefId: string | null;
  questions: ClarificationQuestion[];
  plan: ResearchPlan | null;
  error: string | null;
}

const EMPTY: State = {
  step: "form",
  briefId: null,
  questions: [],
  plan: null,
  error: null,
};

/** The labeled intro sent as the first HumanMessage (`kind: "start"`). The
 * backend folds in the meeting contact from the persisted brief, so it isn't
 * repeated here. */
function startMessage(form: BriefCreate): string {
  return [
    `Company: ${form.company_name}`,
    `Website: ${form.website}`,
    `Objective: ${form.objective}`,
  ].join("\n");
}

/**
 * Drives the new-research modal wizard: create the brief, run phase-1, surface
 * any clarification questions, and land on the generated plan. Approving the
 * plan (starting the job) is intentionally out of scope here.
 */
export function useResearchWizard() {
  const api = useApi();
  const [state, setState] = useState<State>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => () => abort(), [abort]);

  const reset = useCallback(() => {
    abort();
    setState(EMPTY);
  }, [abort]);

  /** Reopen an existing brief that paused mid-flow. Both the clarification
   * questions and the plan are persisted on the brief, so this needs no fetch. */
  const resume = useCallback(
    (brief: Brief) => {
      abort();
      if (brief.status === "awaiting_clarification") {
        setState({
          step: "clarify",
          briefId: brief.id,
          questions: brief.clarification_question?.questions ?? [],
          plan: null,
          error: null,
        });
      } else if (brief.status === "awaiting_plan_approval" && brief.research_plan) {
        setState({
          step: "plan",
          briefId: brief.id,
          questions: [],
          plan: brief.research_plan,
          error: null,
        });
      } else {
        setState({
          step: "error",
          briefId: brief.id,
          questions: [],
          plan: null,
          error: "This research can't be resumed.",
        });
      }
    },
    [abort],
  );

  // Runs one phase-1 turn's SSE stream and folds terminal events into state.
  const consume = useCallback(async (res: Response, signal: AbortSignal) => {
    let terminal = false;
    await readWorkflowSSE(res, (ev) => {
      switch (ev.type) {
        case "clarification_requested":
          terminal = true;
          setState((s) => ({ ...s, step: "clarify", questions: ev.questions, error: null }));
          break;
        case "plan_ready":
          terminal = true;
          setState((s) => ({ ...s, step: "plan", plan: ev.plan, error: null }));
          break;
        case "run_failed":
          terminal = true;
          setState((s) => ({ ...s, step: "error", error: ev.message || "Research failed" }));
          break;
        default:
          // run_started / node_* — ignored; the modal shows a simple loader.
          break;
      }
    });
    if (!terminal && !signal.aborted) {
      setState((s) => ({ ...s, step: "error", error: "The stream ended unexpectedly." }));
    }
  }, []);

  const start = useCallback(
    async (form: BriefCreate) => {
      abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setState({ ...EMPTY, step: "running" });
      try {
        const brief = await api.briefs.create(form);
        if (ctrl.signal.aborted) return;
        setState((s) => ({ ...s, briefId: brief.id }));
        const res = await api.briefs.chat(
          brief.id,
          { kind: "start", message: startMessage(form) },
          ctrl.signal,
        );
        await consume(res, ctrl.signal);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setState((s) => ({
          ...s,
          step: "error",
          error: (e as Error).message ?? "Could not start research",
        }));
      }
    },
    [api, abort, consume],
  );

  const submitAnswers = useCallback(
    async (answers: ClarificationAnswer[]) => {
      const briefId = state.briefId;
      if (!briefId) return;
      abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setState((s) => ({ ...s, step: "running", error: null }));
      try {
        const message = answers.map((a) => `${a.question}\n${a.answer}`).join("\n\n");
        const res = await api.briefs.chat(
          briefId,
          {
            kind: "answer",
            message,
            clarification_question_answered: true,
            clarification_answers: answers,
          },
          ctrl.signal,
        );
        await consume(res, ctrl.signal);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setState((s) => ({
          ...s,
          step: "error",
          error: (e as Error).message ?? "Could not submit answers",
        }));
      }
    },
    [api, abort, consume, state.briefId],
  );

  /** Approve the plan and launch the phase-2 job. Returns the job id. */
  const approve = useCallback(async () => {
    if (!state.briefId) return null;
    return api.briefs.approvePlan(state.briefId);
  }, [api, state.briefId]);

  return { ...state, start, submitAnswers, resume, approve, reset };
}
