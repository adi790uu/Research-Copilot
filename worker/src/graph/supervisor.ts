import { AIMessage, type BaseMessage, ToolMessage } from "@langchain/core/messages";
import {
  Command,
  END,
  type LangGraphRunnableConfig,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { LIMITS } from "@/config";
import { appendResearcherResult, completeTask, createTask, failTask } from "@/db/jobs";
import { researcherGraph } from "@/graph/researcher";
import { conductResearch, researchComplete } from "@/graph/schemas";
import { SupervisorAnnotation, type SupervisorState } from "@/graph/state";
import { createModel } from "@/llm/models";
import { thinkTool } from "@/tools/think";

type Configurable = { jobId?: string };

/** All tool message contents — the findings passed to the report writer. */
function notesFromToolCalls(messages: BaseMessage[]): string[] {
  return messages.filter((m) => m instanceof ToolMessage).map((m) => String(m.content));
}

async function supervisorNode(state: SupervisorState): Promise<Command> {
  const model = createModel({ temperature: 0 })
    .bindTools([conductResearch, researchComplete, thinkTool])
    .withRetry({ stopAfterAttempt: 3 });

  const response = await model.invoke(state.supervisorMessages);
  return new Command({
    goto: "supervisorTools",
    update: {
      supervisorMessages: [response],
      researchIterations: state.researchIterations + 1,
    },
  });
}

async function supervisorToolsNode(
  state: SupervisorState,
  config: LangGraphRunnableConfig,
): Promise<Command> {
  const jobId = (config.configurable as Configurable | undefined)?.jobId;
  const last = state.supervisorMessages.at(-1) as AIMessage;
  const toolCalls = last.tool_calls ?? [];

  const exceeded = state.researchIterations > LIMITS.MAX_RESEARCHER_ITERATIONS;
  const done = toolCalls.some((tc) => tc.name === "ResearchComplete");
  if (exceeded || done || toolCalls.length === 0) {
    return new Command({
      goto: END,
      update: { notes: { type: "override", value: notesFromToolCalls(state.supervisorMessages) } },
    });
  }

  const toolMessages: ToolMessage[] = [];

  // think_tool reflections — record then continue.
  for (const tc of toolCalls.filter((t) => t.name === "think_tool")) {
    toolMessages.push(
      new ToolMessage({
        content: `Reflection recorded: ${(tc.args as { reflection: string }).reflection}`,
        name: "think_tool",
        tool_call_id: tc.id!,
      }),
    );
  }

  const conduct = toolCalls.filter((tc) => tc.name === "ConductResearch");
  const allowed = conduct.slice(0, LIMITS.MAX_CONCURRENT_RESEARCH_UNITS);
  const overflow = conduct.slice(LIMITS.MAX_CONCURRENT_RESEARCH_UNITS);

  const results = await Promise.all(
    allowed.map(async (tc) => {
      const args = tc.args as { research_topic: string; tools_to_use?: string };
      const taskId = jobId ? await createTask(jobId, args.research_topic) : null;
      try {
        const res = await researcherGraph.invoke(
          {
            researchTopic: args.research_topic,
            toolsToUse: args.tools_to_use ?? "both",
            companyName: state.companyName,
            website: state.website,
            researcherMessages: [],
          },
          config,
        );
        if (jobId) {
          await appendResearcherResult(jobId, args.research_topic, res.compressedResearch, res.sources);
          if (taskId) await completeTask(taskId);
        }
        return { tc, summary: res.compressedResearch, rawNotes: res.rawNotes, sources: res.sources };
      } catch (err) {
        if (taskId) await failTask(taskId);
        throw err;
      }
    }),
  );

  for (const r of results) {
    toolMessages.push(
      new ToolMessage({ content: r.summary, name: "ConductResearch", tool_call_id: r.tc.id! }),
    );
  }
  for (const tc of overflow) {
    toolMessages.push(
      new ToolMessage({
        content: `Skipped: maximum ${LIMITS.MAX_CONCURRENT_RESEARCH_UNITS} concurrent researchers per round. Re-dispatch next round if still needed.`,
        name: "ConductResearch",
        tool_call_id: tc.id!,
      }),
    );
  }

  return new Command({
    goto: "supervisor",
    update: {
      supervisorMessages: toolMessages,
      rawNotes: results.flatMap((r) => r.rawNotes),
      sources: results.flatMap((r) => r.sources),
    },
  });
}

const builder = new StateGraph(SupervisorAnnotation)
  .addNode("supervisor", supervisorNode, { ends: ["supervisorTools"] })
  .addNode("supervisorTools", supervisorToolsNode, { ends: ["supervisor", END] })
  .addEdge(START, "supervisor");

export const supervisorGraph = builder.compile();
