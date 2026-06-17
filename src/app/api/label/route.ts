// ================================================================
// PLACEMENT: src/app/api/label/route.ts
// The folder must be:  src/app/api/label/
// The file must be named: route.ts  (NOT label-route.ts)
// ================================================================
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Punchy, eyecatching labels per agent × intent bucket
// The Gemini call will generate contextual ones; these are instant fallbacks
const AGENT_FALLBACKS: Record<string, string> = {
  clarity:   "Locking onto your target…",
  research:  "Hunting live intelligence…",
  validator: "Stress-testing the data…",
  synthesis: "Forging your final report…",
};

function fallback(agent: string) {
  return AGENT_FALLBACKS[agent?.toLowerCase()] ?? "Engaging agents…";
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const agent: string = body?.agent ?? "";
    const query: string = body?.query ?? "";

    if (!agent || !query) {
      return NextResponse.json({ label: fallback(agent) });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[label route] GEMINI_API_KEY missing — using fallback");
      return NextResponse.json({ label: fallback(agent) });
    }

    const agentContext: Record<string, string> = {
      clarity:
        "You are the Clarity Agent. Your job is to figure out EXACTLY what company or topic the user means before wasting time on bad research.",
      research:
        "You are the Research Agent. You are right now firing search queries at the live web, pulling fresh news, financials, and intelligence.",
      validator:
        "You are the Validator Agent. You are tearing apart the raw research, finding holes, checking facts, deciding if it's good enough.",
      synthesis:
        "You are the Synthesis Agent. You are now turning raw data into a polished, executive-grade research report.",
    };

    const agentDesc = agentContext[agent.toLowerCase()] ?? `You are the ${agent} Agent.`;

    const prompt = `${agentDesc}

The user just asked: "${query}"

Write ONE ultra-short status label (5–9 words) that:
- Uses vivid, active, present-tense verbs (scanning, dissecting, forging, cross-checking, uncovering, etc.)
- References something SPECIFIC from the user's query (a company name, topic, or key term)
- Feels urgent and alive — like a war room monitor label
- NO filler words, NO punctuation at end, NO quotes

Examples of the style (do NOT copy these, make your own for this query):
- "Verifying Nvidia revenue claims against SEC filings"
- "Pinpointing OpenAI's latest funding round data"  
- "Stress-testing Tesla bear case assumptions"
- "Cross-referencing Apple supply chain leak reports"

Return ONLY the label. Nothing else.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 30,
            temperature: 0.85,
            stopSequences: ["\n"],
          },
        }),
      }
    );

    if (!response.ok) {
      console.error("[label route] Gemini error:", response.status, response.statusText);
      return NextResponse.json({ label: fallback(agent) });
    }

    const data = await response.json();
    const raw: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Strip any accidental quotes, newlines, trailing punctuation
    const label = raw
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\n.*/g, "")
      .trim();

    return NextResponse.json({ label: label || fallback(agent) });
  } catch (err) {
    console.error("[label route] Unhandled error:", err);
    return NextResponse.json({ label: "Engaging agents…" });
  }
}