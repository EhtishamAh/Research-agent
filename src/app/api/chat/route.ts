// src/app/api/chat/route.ts
import { NextResponse } from "next/server";
import { multiAgentGraph } from "@/lib/graph";
import { HumanMessage } from "@langchain/core/messages";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { threadId, message } = body;

    if (!threadId || !message) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const config = { configurable: { thread_id: threadId } };

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    // Helper functions to prevent crashes if the user aborts the stream
    const safeWrite = async (text: string) => {
      try { await writer.write(encoder.encode(text)); } catch (e) { /* Ignore closed stream */ }
    };
    const safeClose = async () => {
      try { await writer.close(); } catch (e) { /* Ignore closed stream */ }
    };

// Start graph execution in the background
    (async () => {
      try {
        const eventStream = await multiAgentGraph.streamEvents(
          { messages: [new HumanMessage(message)] },
          { ...config, version: "v2" }
        );

        for await (const event of eventStream) {
          // 1. SIGNAL FRONTEND WHICH AGENT IS RUNNING
          if (event.event === "on_chain_start") {
            const node = event.name;
            // Intercept our main nodes and broadcast their start
            if (["clarity", "research", "validator", "synthesis"].includes(node)) {
              await safeWrite(`[[AGENT:${node}]]`);
            }
          }

          // 2. STREAM SYNTHESIS CHUNKS
          if (
            event.event === "on_chat_model_stream" &&
            event.metadata?.langgraph_node === "synthesis"
          ) {
            const chunk = event.data?.chunk?.content;
            if (chunk) {
              await safeWrite(chunk);
            }
          }

          // 3. CATCH CLARITY QUESTIONS
          if (event.event === "on_chain_end" && event.name === "clarity") {
            const output = event.data?.output;
            if (output?.clarity_status === "needs_clarification" && output?.messages?.length > 0) {
              const messages = output.messages;
              const clarityQuestion = messages[messages.length - 1].content;
              if (clarityQuestion) {
                await safeWrite(clarityQuestion);
              }
            }
          }
        }
      } catch (err: unknown) {
        const error = err as { message?: string; code?: string };
        if (error.message !== "ResponseAborted" && error.code !== "ERR_INVALID_STATE") {
           console.error("Stream Error:", err);
           await safeWrite("\n\n[Error generating response. Please try again.]");
        }
      } finally {
        // 4. FORCE THE FRONTEND TO UNLOCK
        await safeWrite("[[DONE]]");
        await safeClose();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });

  } catch (error) {
    console.error("API Route Error:", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}