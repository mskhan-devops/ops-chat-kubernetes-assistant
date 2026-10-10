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

const LM_STUDIO_BASE_URL = process.env.LM_STUDIO_BASE_URL ?? "http://localhost:1234/v1";

// This handler is used for BOTH genuine stream/model errors and ordinary tool
// execution errors (see tool-error in the AI SDK). Rewriting everything to
// "is LM Studio running?" hid real kubectl failures, so only connection-style
// errors get the friendly hint; anything else surfaces its real message.
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|socket hang up|other side closed|terminated|network|connect/i.test(message)) {
    return `Cannot reach the model server at ${LM_STUDIO_BASE_URL} — is LM Studio running and the model loaded? (${message})`;
  }
  return message || "Something went wrong.";
}

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
      return describeError(error);
    },
  });
}
