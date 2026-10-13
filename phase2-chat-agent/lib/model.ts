// Generic OpenAI-compatible LLM provider.
// 
// Supports any OpenAI-compatible API endpoint (LM Studio, OpenRouter, Groq,
// Together, Fireworks, etc.). Configured via environment variables with
// backward compatibility for LM Studio-specific names.

import { createOpenAI } from "@ai-sdk/openai";

export const DEFAULT_LLM_BASE_URL =
  process.env.LLM_BASE_URL ??
  process.env.LM_STUDIO_BASE_URL ??
  "http://localhost:1234/v1";

export const DEFAULT_LLM_MODEL =
  process.env.LLM_MODEL ??
  process.env.LM_STUDIO_MODEL ??
  "local-model";

export const DEFAULT_LLM_API_KEY =
  process.env.LLM_API_KEY ??
  process.env.LM_STUDIO_API_KEY ??
  "lm-studio";

export const DEFAULT_LLM_PROVIDER_NAME =
  process.env.LLM_PROVIDER_NAME ?? "openai-compatible";

export function createChatModel(config?: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  name?: string;
}) {
  const baseURL = config?.baseUrl && config.baseUrl.trim() ? config.baseUrl.trim() : DEFAULT_LLM_BASE_URL;
  const apiKey = config?.apiKey && config.apiKey.trim() ? config.apiKey.trim() : DEFAULT_LLM_API_KEY;
  const model = config?.model && config.model.trim() ? config.model.trim() : DEFAULT_LLM_MODEL;
  const name = config?.name && config.name.trim() ? config.name.trim() : DEFAULT_LLM_PROVIDER_NAME;

  const provider = createOpenAI({
    name,
    baseURL,
    apiKey,
  });

  return provider.chat(model);
}

// Backward compatibility
export const LLM_BASE_URL = DEFAULT_LLM_BASE_URL;
export const LLM_MODEL = DEFAULT_LLM_MODEL;
export const LLM_API_KEY = DEFAULT_LLM_API_KEY;
export const LM_STUDIO_BASE_URL = DEFAULT_LLM_BASE_URL;
export const LM_STUDIO_MODEL = DEFAULT_LLM_MODEL;
export const lmStudio = createOpenAI({
  name: DEFAULT_LLM_PROVIDER_NAME,
  baseURL: DEFAULT_LLM_BASE_URL,
  apiKey: DEFAULT_LLM_API_KEY,
});
export const chatModel = lmStudio.chat(DEFAULT_LLM_MODEL);
