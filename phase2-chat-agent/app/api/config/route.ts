import { NextResponse } from "next/server";

export async function GET() {
  const baseUrl =
    process.env.LLM_BASE_URL ||
    process.env.LM_STUDIO_BASE_URL ||
    "";
  const model =
    process.env.LLM_MODEL ||
    process.env.LM_STUDIO_MODEL ||
    "";
  const apiKey = process.env.LLM_API_KEY || process.env.LM_STUDIO_API_KEY || "";
  return NextResponse.json({
    baseUrl,
    model,
    apiKey,
    apiKeySet: !!apiKey,
  });
}
