import { createHash } from "node:crypto";
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
import type { Source, SourceType } from "@/db/schema";
import { ResearcherAnnotation, type ResearcherState } from "@/graph/state";
import { createModel, isTokenLimitExceeded } from "@/llm/models";
import {
  compressResearchHumanMessage,
  compressResearchSystemPrompt,
  researcherSystemPrompt,
  todayStr,
} from "@/prompts";
import { companySiteSearch, webCompanySearch } from "@/tools/company-search";
import { thinkTool } from "@/tools/think";

// "--- SOURCE N: title --- / URL: ... / Type: ..." — emitted by the company tools.
const SOURCE_RE = /--- SOURCE \d+: (.+?) ---\nURL: (\S+)\nType: (\w+)\n/g;

const sourceId = (url: string): string => `src_${createHash("sha1").update(url).digest("hex").slice(0, 8)}`;

function normalizeType(t: string): SourceType | null {
  const s = t.trim().toLowerCase();
  return s === "company_site" || s === "web" ? s : null;
}

function extractSources(messages: BaseMessage[]): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const msg of messages) {
    if (!(msg instanceof ToolMessage)) continue;
    const content = typeof msg.content === "string" ? msg.content : "";
    for (const [, title, url, stype] of content.matchAll(SOURCE_RE)) {
      if (seen.has(url)) continue;
      seen.add(url);
      sources.push({ id: sourceId(url), url: url.trim(), title: title.trim(), type: normalizeType(stype) });
    }
  }
  return sources;
}

function selectTools(toolsToUse: string): StructuredToolInterface[] {
  if (toolsToUse === "company_site") return [companySiteSearch, thinkTool];
  if (toolsToUse === "web") return [webCompanySearch, thinkTool];
  return [companySiteSearch, webCompanySearch, thinkTool];
}

function renderToolsSection(tools: StructuredToolInterface[]): { section: string; routing: string } {
  const names = tools.map((t) => t.name);
  const lines = tools.map((t, i) => {
    if (t.name === "company_site_search")
      return `${i + 1}. company_site_search: scrape the company's own website (about, products, blog, pricing).`;
    if (t.name === "web_company_search")
      return `${i + 1}. web_company_search: external sources (news, funding, reviews). Company name is prepended automatically.`;
    return `${i + 1}. think_tool: short reflection on findings or next steps. Do not call in parallel with other tools.`;
  });
  let routing: string;
  if (names.includes("company_site_search") && names.includes("web_company_search"))
    routing = "Use BOTH company_site_search and web_company_search. Start on the company site for grounding, then go external for signals.";
  else if (names.includes("company_site_search"))
    routing = "Use company_site_search for every query. Stay on the company's own pages.";
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
