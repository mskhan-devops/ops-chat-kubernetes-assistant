import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { createChatModel } from "@/lib/model";
import { SYSTEM_PROMPT, MAX_STEPS } from "@/lib/agent";
import { createClusterTools } from "@/lib/tools";
import { createApprovalChecker } from "@/lib/approvals";

export const maxDuration = 300;

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");

  // OpenAI-compatible providers return structured HTTP errors; the AI SDK
  // surfaces them as APICallError with a statusCode. Map the common cases so
  // the user sees WHY a request failed (bad model name, bad key, billing).
  const status =
    (error as { statusCode?: number } | null | undefined)?.statusCode ??
    (error as { status?: number } | null | undefined)?.status;

  if (status) {
    if (status === 401) {
      return `Unauthorized (401) — check the API key for the selected provider. (${message})`;
    }
    if (status === 402) {
      return `Payment Required (402) — the selected model requires credits/payment for this provider. (${message})`;
    }
    if (status === 403) {
      return `Forbidden (403) — the API key may lack access to this model or the provider rejected authorization. (${message})`;
    }
    if (status === 404) {
      return `Model Not Found (404) — the selected model does not exist on this provider. Pick it from the fetched list. (${message})`;
    }
    if (status === 429) {
      return `Rate limited (429) — the provider is throttling requests; try again shortly. (${message})`;
    }
    if (status >= 500) {
      return `Provider server error (${status}) — the LLM service failed. (${message})`;
    }
  }

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
