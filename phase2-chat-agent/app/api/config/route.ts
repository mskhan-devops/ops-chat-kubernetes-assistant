import { NextResponse } from "next/server";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_API_KEY,
} from "@/lib/model";

export async function GET() {
  return NextResponse.json({
    baseUrl: DEFAULT_LLM_BASE_URL,
    model: DEFAULT_LLM_MODEL,
    apiKeySet: !!DEFAULT_LLM_API_KEY && DEFAULT_LLM_API_KEY !== "lm-studio",
  });
}
