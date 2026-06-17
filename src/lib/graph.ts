import { 
  StateGraph, 
  START, 
  END, 
  MemorySaver
} from "@langchain/langgraph";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import { GraphState, AgentState } from "./schema";

if (!process.env.LANGCHAIN_API_KEY || process.env.LANGCHAIN_TRACING_V2 !== "true") {
  process.env.LANGCHAIN_TRACING_V2 = "false";
}

if (!process.env.GEMINI_API_KEY) {
  console.error("CRITICAL ERROR: GEMINI_API_KEY is missing from .env.local!");
  throw new Error("GEMINI_API_KEY is not defined in environment variables.");
}

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-3.1-flash-lite",
  apiKey: process.env.GEMINI_API_KEY as string,
  temperature: 0,
});

async function runTavilySearch(query: string): Promise<string> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        include_answer: true,
        max_results: 5,
      }),
    });
    if (!res.ok) throw new Error(`Tavily error: ${res.statusText}`);
    const data = await res.json();
    let resultText = data.answer ? `Summary: ${data.answer}\n` : "";
    if (data.results && Array.isArray(data.results)) {
      resultText += data.results
        .map((r: { title: string; url: string; content: string }) =>
          `- [${r.title}](${r.url}): ${r.content}`
        )
        .join("\n");
    }
    return resultText;
  } catch (error) {
    console.error("Tavily Search Failed:", error);
    return "Search failed. No data retrieved.";
  }
}

// ── Each node tags its LLM calls with runName so LangSmith shows them
//    as distinct child spans under the node name ─────────────────────

async function clarityNode(state: AgentState) {
  const schema = z.object({
    status: z.enum(["clear", "needs_clarification"]),
    reasoning: z.string(),
    clarification_prompt: z.string().optional(),
  });

  const structuredLlm = llm.withStructuredOutput(schema);
  const systemPrompt = new SystemMessage(
    "You are the Clarity Agent. Analyze context to determine if a specific company or target is explicit. " +
    "You MUST return ONLY valid JSON without any markdown formatting, backticks, or conversational text."
  );

  const safeHistory = state.messages.filter((msg) => msg._getType() !== "system");

  // runName makes this span appear as "Clarity — intent check" in LangSmith
  const response = await structuredLlm.invoke(
    [systemPrompt, ...safeHistory],
    { runName: "Clarity — intent check" }
  );

  if (response.status === "needs_clarification") {
    const question = response.clarification_prompt || "Which company are you asking about?";
    return {
      clarity_status: "needs_clarification",
      messages: [new AIMessage(question)],
    };
  }
  return { clarity_status: "clear" };
}

async function researchNode(state: AgentState) {
  const safeHistory = state.messages.filter((msg) => msg._getType() !== "system");

  // Step 1 — query generation
  const querySchema = z.object({ search_query: z.string() });
  const queryLlm = llm.withStructuredOutput(querySchema);
  const queryPrompt = new SystemMessage(
    "Generate a targeted search query for this company topic. " +
    "You MUST return ONLY valid JSON without any markdown formatting or extra text."
  );

  const queryRes = await queryLlm.invoke(
    [queryPrompt, ...safeHistory],
    { runName: "Research — query generation" }
  );

  // Step 2 — Tavily web search (runs outside LLM, shows as its own step)
  const searchResults = await runTavilySearch(queryRes.search_query);

  // Step 3 — confidence scoring
  const scoreSchema = z.object({ confidence_score: z.number().min(0).max(10) });
  const scoreLlm = llm.withStructuredOutput(scoreSchema);
  const evaluationPrompt = new SystemMessage(
    `Rate this data from 0-10 based on user intent. ` +
    `You MUST return ONLY valid JSON without any markdown formatting or extra text.\n\nData:\n${searchResults}`
  );

  const scoreRes = await scoreLlm.invoke(
    [evaluationPrompt, ...safeHistory],
    { runName: "Research — confidence scoring" }
  );

  return {
    context_data: `[Query: ${queryRes.search_query}]\n${searchResults}`,
    confidence_score: scoreRes.confidence_score,
  };
}

async function validatorNode(state: AgentState) {
  const safeHistory = state.messages.filter((msg) => msg._getType() !== "system");

  const schema = z.object({
    validation_result: z.enum(["sufficient", "insufficient"]),
    gaps_identified: z.string(),
  });
  const structuredLlm = llm.withStructuredOutput(schema);
  const systemPrompt = new SystemMessage(
    `Validate if research matches query requirements:\n${state.context_data}\n\n` +
    `You MUST return ONLY valid JSON without any markdown formatting or extra text.`
  );

  const response = await structuredLlm.invoke(
    [systemPrompt, ...safeHistory],
    { runName: "Validator — gap analysis" }
  );

  if (response.validation_result === "insufficient" && state.attempts < 2) {
    return {
      validation_result: "insufficient",
      attempts: 1,
      messages: [
        new HumanMessage(
          `System Feedback: You missed some information. Please fill these gaps: ${response.gaps_identified}`
        ),
      ],
    };
  }
  return { validation_result: "sufficient", attempts: 1 };
}

async function synthesisNode(state: AgentState) {
  const safeHistory = state.messages.filter((msg) => msg._getType() !== "system");

  const systemPrompt = new SystemMessage(
    "You are an elite, professional Business Research Assistant. Your goal is to synthesize research into a clear, highly readable report based on the user's specific query.\n\n" +
    "CRITICAL FORMATTING INSTRUCTIONS:\n" +
    "1. DYNAMIC STRUCTURE: Organize your response logically based on what the user is asking. Create relevant, contextual headings rather than a fixed template.\n" +
    "2. STRICT MARKDOWN: You MUST use proper Markdown to structure your report.\n" +
    "   - Use '### ' for all main section headings.\n" +
    "   - Use '* ' for bulleted lists.\n" +
    "   - Use '**' to bold key entities, metrics, or insights.\n" +
    "3. TONE: Be direct, concise, and highly analytical. Avoid conversational fluff.\n\n" +
    "Use ONLY the provided Research Context Data to answer the user's request. If the data is missing, state what is unknown.\n\n" +
    `Research Context Data:\n${state.context_data}`
  );

  const response = await llm.invoke(
    [systemPrompt, ...safeHistory],
    { runName: "Synthesis — report generation" }
  );

  return {
    messages: [new AIMessage(String(response.content))],
    attempts: 0,
    context_data: "",
  };
}

// ─── Routing ──────────────────────────────────────────────────────────────────
function routeAfterClarity(state: AgentState) {
  if (state.clarity_status === "needs_clarification") return END;
  return "research";
}

function routeAfterResearch(state: AgentState) {
  return state.confidence_score < 6 ? "validator" : "synthesis";
}

function routeAfterValidator(state: AgentState) {
  if (state.validation_result === "insufficient" && state.attempts < 3) return "research";
  return "synthesis";
}

// ─── Graph assembly ───────────────────────────────────────────────────────────
const builder = new StateGraph(GraphState)
  .addNode("clarity",   clarityNode)
  .addNode("research",  researchNode)
  .addNode("validator", validatorNode)
  .addNode("synthesis", synthesisNode)
  .addEdge(START, "clarity")
  .addConditionalEdges("clarity",   routeAfterClarity)
  .addConditionalEdges("research",  routeAfterResearch)
  .addConditionalEdges("validator", routeAfterValidator)
  .addEdge("synthesis", END);

const checkpointer = new MemorySaver();
export const multiAgentGraph = builder.compile({ checkpointer });