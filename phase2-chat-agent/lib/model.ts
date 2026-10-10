// Local LLM provider — LM Studio's OpenAI-compatible server.
//
// LM Studio serves an OpenAI-compatible API at http://localhost:1234/v1 by
// default, so we reuse the official OpenAI provider and just point its baseURL
// at it. `.chat()` forces the stateless Chat Completions endpoint.
//
// Everything is driven by environment variables (see .env.example):
//   LM_STUDIO_BASE_URL, LM_STUDIO_API_KEY, LM_STUDIO_MODEL
//
// Docs: https://lmstudio.ai/docs/app/api/endpoints/openai

import { createOpenAI } from "@ai-sdk/openai";

export const LM_STUDIO_BASE_URL =
  process.env.LM_STUDIO_BASE_URL ?? "http://localhost:1234/v1";

export const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL ?? "local-model";

export const lmStudio = createOpenAI({
  name: "lm-studio",
  baseURL: LM_STUDIO_BASE_URL,
  // LM Studio ignores the key, but the OpenAI client requires one to be set.
  apiKey: process.env.LM_STUDIO_API_KEY ?? "lm-studio",
});

// The chat-completions model handle used by the agent.
export const chatModel = lmStudio.chat(LM_STUDIO_MODEL);
