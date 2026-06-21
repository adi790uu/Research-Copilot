import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  END,
  type LangGraphRunnableConfig,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { LIMITS } from "@/config";
import { finalReportNode } from "@/graph/report";
import { Graph2Annotation, type Graph2State } from "@/graph/state";
import { supervisorGraph } from "@/graph/supervisor";
import { leadResearcherPrompt, todayStr } from "@/prompts";

// Runs the supervisor subgraph seeded with the brief/plan, then surfaces its
// notes + sources to the top-level state for the report node.
async function researchSupervisorNode(
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

  return { notes: res.notes, rawNotes: res.rawNotes, sources: res.sources };
}

const builder = new StateGraph(Graph2Annotation)
  .addNode("research_supervisor", researchSupervisorNode)
  .addNode("final_report_generation", finalReportNode)
  .addEdge(START, "research_supervisor")
  .addEdge("research_supervisor", "final_report_generation")
  .addEdge("final_report_generation", END);

export const graph2 = builder.compile();
