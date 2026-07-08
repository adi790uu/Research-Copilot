import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  END,
  type LangGraphRunnableConfig,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { LIMITS } from "@/config";
import { completeTask, createTask, failTask } from "@/db/jobs";
import { companyReportNode, personReportNode, pitchNode } from "@/graph/report";
import { researcherGraph } from "@/graph/researcher";
import { Graph2Annotation, type Graph2State } from "@/graph/state";
import { supervisorGraph } from "@/graph/supervisor";
import { leadResearcherPrompt, todayStr } from "@/prompts";

type Configurable = { jobId?: string };

// Company research — the existing supervisor, kept company-only (no person
// dispatch; the contact is a dedicated parallel branch below).
async function companyResearchNode(
  state: Graph2State,
  config: LangGraphRunnableConfig,
): Promise<Partial<Graph2State>> {
  const seed = [
    new SystemMessage(
      leadResearcherPrompt({
        companyName: state.companyName,
        website: state.website,
        date: todayStr(),
        maxConcurrentResearchUnits: LIMITS.MAX_CONCURRENT_RESEARCH_UNITS,
        maxResearcherIterations: LIMITS.MAX_RESEARCHER_ITERATIONS,
      }),
    ),
    new HumanMessage(state.researchBrief),
  ];

  const res = await supervisorGraph.invoke(
    {
      companyName: state.companyName,
      website: state.website,
      researchBrief: state.researchBrief,
      supervisorMessages: seed,
      researchIterations: 0,
    },
    config,
  );

  return { companyNotes: res.notes, companySources: res.sources };
}

// Person research — a single focused researcher run over the person tools.
// Identity is gated inside person_search (a candidate is only reported if it
// ties back to the target company), so a namesake is never surfaced. No-ops
// when the brief has no named contact.
async function personResearchNode(
  state: Graph2State,
  config: LangGraphRunnableConfig,
): Promise<Partial<Graph2State>> {
  if (!state.personName) return {};

  const jobId = (config.configurable as Configurable | undefined)?.jobId;
  const topic = `Research the meeting contact ${state.personName}${
    state.personTitle ? ` (${state.personTitle})` : ""
  } at ${state.companyName}: their role, background, and likely priorities for a sales conversation. Verify their identity against ${state.companyName} before reporting anything — never attribute an unrelated namesake.`;

  const taskId = jobId ? await createTask(jobId, `Meeting contact: ${state.personName}`) : null;
  try {
    const res = await researcherGraph.invoke(
      {
        researchTopic: topic,
        toolsToUse: "person",
        companyName: state.companyName,
        website: state.website,
        researcherMessages: [],
      },
      config,
    );
    if (taskId) await completeTask(taskId);
    return { personNotes: [res.compressedResearch], personSources: res.sources };
  } catch (err) {
    if (taskId) await failTask(taskId);
    return { personNotes: [], personSources: [] };
  }
}

const builder = new StateGraph(Graph2Annotation)
  .addNode("company_research", companyResearchNode)
  .addNode("person_research", personResearchNode)
  .addNode("company_report", companyReportNode)
  .addNode("person_report", personReportNode)
  .addNode("pitch_generation", pitchNode)
  // Company and person research run in parallel from the start.
  .addEdge(START, "company_research")
  .addEdge(START, "person_research")
  .addEdge("company_research", "company_report")
  .addEdge("person_research", "person_report")
  // Pitch joins both reports (barrier) and is produced only when the seller
  // has company context (decided inside the node).
  .addEdge("company_report", "pitch_generation")
  .addEdge("person_report", "pitch_generation")
  .addEdge("pitch_generation", END);

export const graph2 = builder.compile();
