// ── Local chat endpoint ──
//
// Replaces the Trigger.dev durable task + transport. This plain Next.js route
// runs the same agent loop (streamText + kubectl tools + HITL) entirely on your
// machine, talking to LM Studio for inference.
//
// The browser sends the full UIMessage history; we convert it to model messages,
// run the loop, and stream the result back as a UI message stream. Tools with no
// execute (proposeDeletion / proposeMemoryIncrease) pause the loop and wait for
// the client to supply { approved } via addToolOutput, then the client resends.

import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { chatModel } from "@/lib/model";
import { SYSTEM_PROMPT, MAX_STEPS } from "@/lib/agent";
import { clusterTools } from "@/lib/tools";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: chatModel,
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools: clusterTools,
    stopWhen: stepCountIs(MAX_STEPS),
    onError: ({ error }) => {
      console.error("[ops-chat] stream error:", error);
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (error: unknown) => {
      console.error("[ops-chat] UI stream error:", error);
      return "Something went wrong talking to LM Studio. Is it running and is the model loaded?";
    },
  });
}
