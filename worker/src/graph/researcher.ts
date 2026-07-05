import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  Command,
  END,
  type LangGraphRunnableConfig,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { LIMITS } from "@/config";
import type { Source } from "@/db/schema";
import { parseSourceBlocks } from "@/graph/sources";
import { ResearcherAnnotation, type ResearcherState } from "@/graph/state";
import { createModel, isTokenLimitExceeded } from "@/llm/models";
import {
  compressResearchHumanMessage,
  compressResearchSystemPrompt,
  researcherSystemPrompt,
  todayStr,
} from "@/prompts";
import { companySiteSearch, socialSearch, webCompanySearch } from "@/tools/company-search";
import { personSearch } from "@/tools/person-search";
import { thinkTool } from "@/tools/think";

function extractSources(messages: BaseMessage[]): Source[] {
  const toolText = messages
    .filter((m) => m instanceof ToolMessage)
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
  return parseSourceBlocks(toolText);
}

function selectTools(toolsToUse: string): StructuredToolInterface[] {
  if (toolsToUse === "company_site") return [companySiteSearch, thinkTool];
  if (toolsToUse === "web") return [webCompanySearch, thinkTool];
  if (toolsToUse === "social") return [socialSearch, thinkTool];
  if (toolsToUse === "person") return [personSearch, thinkTool];
  return [companySiteSearch, webCompanySearch, socialSearch, thinkTool];
}

function renderToolsSection(tools: StructuredToolInterface[]): { section: string; routing: string } {
  const names = tools.map((t) => t.name);
  const lines = tools.map((t, i) => {
    const n = i + 1;
    if (t.name === "company_site_search")
      return `${n}. company_site_search: scrape the company's own website (about, products, blog, pricing).`;
    if (t.name === "web_company_search")
      return `${n}. web_company_search: external sources (news, funding, reviews). Company name is prepended automatically.`;
    if (t.name === "social_search")
      return `${n}. social_search: the company's verified LinkedIn and X (Twitter) profiles plus Reddit and other public discussion (sentiment, reviews, employee experience). Company name is prepended automatically.`;
    if (t.name === "person_search")
      return `${n}. person_search: research the specific named meeting contact — their role, background, and public activity. Every candidate is checked against the target company before being reported; an unrelated namesake is never surfaced as a match.`;
    return `${n}. think_tool: short reflection on findings or next steps. Do not call in parallel with other tools.`;
  });
  const search = names.filter((n) => n !== "think_tool");
  let routing: string;
  if (search.length > 1)
    routing = `Use ${search.join(", ")} — route each query to the source most likely to hold the answer. Start on the company site for grounding, then go external for signals and to social_search for sentiment.`;
  else if (search[0] === "company_site_search")
    routing = "Use company_site_search for every query. Stay on the company's own pages.";
  else if (search[0] === "social_search")
    routing = "Use social_search for every query. It covers the company's social profiles and public discussion; the company name is anchored automatically.";
  else if (search[0] === "person_search")
    routing =
      "Use person_search for every query. If it reports the person could not be verified, do not guess — carry that gap into your findings explicitly.";
  else routing = "Use web_company_search for every query. The company name is anchored automatically.";
  return { section: lines.join("\n"), routing };
}

async function researcherNode(state: ResearcherState): Promise<Command> {
  const tools = selectTools(state.toolsToUse);
  const { section, routing } = renderToolsSection(tools);
  const model = createModel({ temperature: 0 }).bindTools(tools).withRetry({ stopAfterAttempt: 2 });

  const prompt = researcherSystemPrompt({
    companyName: state.companyName,
    website: state.website,
    researchTopic: state.researchTopic,
    toolsSection: section,
    toolRouting: routing,
    date: todayStr(),
  });
  const response = await model.invoke([new SystemMessage(prompt), ...state.researcherMessages]);

  return new Command({
    goto: "researcherTools",
    update: {
      researcherMessages: [response],
      toolCallIterations: state.toolCallIterations + 1,
    },
  });
}

async function researcherToolsNode(
  state: ResearcherState,
  config: LangGraphRunnableConfig,
): Promise<Command> {
  const last = state.researcherMessages.at(-1) as AIMessage;
  const toolCalls = last.tool_calls ?? [];
  if (toolCalls.length === 0) return new Command({ goto: "compressResearch" });

  const byName = new Map(selectTools(state.toolsToUse).map((t) => [t.name, t]));
  const outputs = await Promise.all(
    toolCalls.map(async (tc) => {
      const t = byName.get(tc.name);
      const content = t
        ? await t.invoke(tc.args, config)
        : `Tool '${tc.name}' is not available. Use one of: ${[...byName.keys()].join(", ")}.`;
      return new ToolMessage({ content, name: tc.name, tool_call_id: tc.id! });
    }),
  );

  const exceeded = state.toolCallIterations >= LIMITS.MAX_REACT_TOOL_CALLS;
  return new Command({
    goto: exceeded ? "compressResearch" : "researcher",
    update: { researcherMessages: outputs },
  });
}

async function compressResearchNode(state: ResearcherState): Promise<Partial<ResearcherState>> {
  const model = createModel({ temperature: 0 });
  const sources = extractSources(state.researcherMessages);
  let messages: BaseMessage[] = [
    ...state.researcherMessages,
    new HumanMessage(compressResearchHumanMessage(state.companyName)),
  ];

  const rawNotesFrom = (msgs: BaseMessage[]): string =>
    msgs.filter((m) => m instanceof AIMessage || m instanceof ToolMessage).map((m) => String(m.content)).join("\n");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await model.invoke([
        new SystemMessage(compressResearchSystemPrompt({ companyName: state.companyName, date: todayStr() })),
        ...messages,
      ]);
      return { compressedResearch: String(response.content), rawNotes: [rawNotesFrom(messages)], sources };
    } catch (err) {
      if (isTokenLimitExceeded(err)) {
        let lastAi = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i] instanceof AIMessage) {
            lastAi = i;
            break;
          }
        }
        if (lastAi >= 0) messages = messages.slice(0, lastAi);
        continue;
      }
      break;
    }
  }
  return {
    compressedResearch: "Error compressing research findings (max retries exceeded).",
    rawNotes: [rawNotesFrom(messages)],
    sources,
  };
}

const builder = new StateGraph(ResearcherAnnotation)
  .addNode("researcher", researcherNode, { ends: ["researcherTools"] })
  .addNode("researcherTools", researcherToolsNode, { ends: ["researcher", "compressResearch"] })
  .addNode("compressResearch", compressResearchNode)
  .addEdge(START, "researcher")
  .addEdge("compressResearch", END);

export const researcherGraph = builder.compile();
