import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { createChatModel } from "@/lib/model";
import { SYSTEM_PROMPT, MAX_STEPS } from "@/lib/agent";
import { createClusterTools } from "@/lib/tools";
import { createApprovalChecker } from "@/lib/approvals";

export const maxDuration = 300;

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|socket hang up|other side closed|terminated|network|connect/i.test(message)) {
    return `Cannot reach the model server — is your LLM provider running and the model configured? (${message})`;
  }
  return message || "Something went wrong.";
}

export async function POST(req: Request) {
  const { messages, config }: { messages: UIMessage[]; config?: { baseUrl?: string; apiKey?: string; model?: string } } = await req.json();

  const requireApproval = createApprovalChecker(messages);
  const tools = createClusterTools(requireApproval);
  const chatModel = createChatModel({
    baseUrl: config?.baseUrl,
    apiKey: config?.apiKey,
    model: config?.model,
  });

  const result = streamText({
    model: chatModel,
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages, {
      tools,
      ignoreIncompleteToolCalls: true,
    }),
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
