import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { baseUrl, apiKey } = await req.json();

  if (!baseUrl) {
    return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
  }

  let url = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  if (!url.endsWith("/v1/models") && !url.endsWith("/models")) {
    url = url.endsWith("/v1") ? `${url}/models` : `${url}/v1/models`;
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, {
      headers,
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch models: ${res.statusText}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
