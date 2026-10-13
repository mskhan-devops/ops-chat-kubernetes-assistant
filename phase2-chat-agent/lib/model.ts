// Generic OpenAI-compatible LLM provider.
// 
// Supports any OpenAI-compatible API endpoint (LM Studio, OpenRouter, Groq,
// Together, Fireworks, etc.). Configured via environment variables with
// backward compatibility for LM Studio-specific names.
//
// Environment variables (see .env.example):
//   LLM_BASE_URL or LM_STUDIO_BASE_URL (default: http://localhost:1234/v1)
//   LLM_API_KEY or LM_STUDIO_API_KEY (default: lm-studio)
//   LLM_MODEL or LM_STUDIO_MODEL (default: local-model)
//   LLM_PROVIDER_NAME (optional, default: "openai-compatible")

import { createOpenAI } from "@ai-sdk/openai";

export const LLM_BASE_URL =
  process.env.LLM_BASE_URL ??
  process.env.LM_STUDIO_BASE_URL ??
  "http://localhost:1234/v1";

export const LLM_MODEL =
  process.env.LLM_MODEL ??
  process.env.LM_STUDIO_MODEL ??
  "local-model";

export const LLM_API_KEY =
  process.env.LLM_API_KEY ??
  process.env.LM_STUDIO_API_KEY ??
  "lm-studio";

export const LLM_PROVIDER_NAME = process.env.LLM_PROVIDER_NAME ?? "openai-compatible";

export const openaiCompatible = createOpenAI({
  name: LLM_PROVIDER_NAME,
  baseURL: LLM_BASE_URL,
  apiKey: LLM_API_KEY,
});

// For backward compatibility with existing code
export const LM_STUDIO_BASE_URL = LLM_BASE_URL;
export const LM_STUDIO_MODEL = LLM_MODEL;
export const lmStudio = openaiCompatible;

// The chat-completions model handle used by the agent.
export const chatModel = openaiCompatible.chat(LLM_MODEL);
