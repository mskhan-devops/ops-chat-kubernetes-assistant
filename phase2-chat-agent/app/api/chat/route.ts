// ── Local chat endpoint ──
//
// Replaces the Trigger.dev durable task + transport. This plain Next.js route
// runs the same agent loop (streamText + kubectl tools + HITL) entirely on your
// machine, talking to LM Studio for inference.
//
// The browser sends the full UIMessage history; we convert it to model messages,
// run the loop, and stream the result back as a UI message stream. Tools with no
// execute (the propose* tools) pause the loop and wait for the client to supply
// { approved } via addToolOutput, then the client resends. Mutating tools are
// additionally guarded server-side by createApprovalChecker so a denial cannot
// be bypassed by the model.

import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { chatModel } from "@/lib/model";
import { SYSTEM_PROMPT, MAX_STEPS } from "@/lib/agent";
import { createClusterTools } from "@/lib/tools";
import { createApprovalChecker } from "@/lib/approvals";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Enforce HITL in code, not just in the prompt: mutating tools throw unless
  // the message history contains an approved, unused proposal for the same target.
  const requireApproval = createApprovalChecker(messages);
  const tools = createClusterTools(requireApproval);

  const result = streamText({
    model: chatModel,
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools,
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
