import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { baseUrl, apiKey } = await req.json();

  if (!baseUrl || !baseUrl.trim()) {
    return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
  }

  let url = baseUrl.trim();
  url = url.endsWith("/") ? url.slice(0, -1) : url;
  if (!url.endsWith("/v1/models") && !url.includes("/models")) {
    if (url.endsWith("/v1")) {
      url = url + "/models";
    } else {
      url = url + "/v1/models";
    }
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
    if (apiKey && apiKey.trim()) {
      headers["Authorization"] = "Bearer " + apiKey.trim();
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      const text = await res.text();
      let error: string;
      switch (res.status) {
        case 401:
          error = "Unauthorized (401) — check the API key for this provider.";
          break;
        case 402:
          error = "Payment Required (402) — this provider needs credits/payment.";
          break;
        case 403:
          error = "Forbidden (403) — the API key may not be allowed to list models.";
          break;
        case 404:
          error = "Not Found (404) — no models API endpoint found at this base URL.";
          break;
        case 429:
          error = "Rate limited (429) — the provider is throttling requests; try again shortly.";
          break;
        default:
          error = `Failed to fetch models: ${res.status} ${res.statusText}`;
      }
      return NextResponse.json(
        { error, status: res.status, details: text.slice(0, 500) },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|socket hang up/i.test(msg)) {
      return NextResponse.json(
        { error: `Cannot reach ${url} — check the base URL and that the provider is online. (${msg})`, status: 502 },
        { status: 502 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
