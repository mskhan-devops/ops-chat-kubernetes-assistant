"use client";

import { useEffect, useState } from "react";

export type LLMConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const PROVIDERS = [
  { name: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", defaultModels: ["local-model", "my-chat-model", "llama-3.1-8b-instruct"] },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModels: ["meta-llama/llama-3.1-8b-instruct:free", "google/gemma-2-9b-it:free", "deepseek/deepseek-chat-v3-0324:free"] },
  { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModels: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"] },
  { name: "Custom (OpenAI-compatible)", baseUrl: "", defaultModels: ["your-model-name"] },
];

export function LLMSelector({ value, onChange }: { value: LLMConfig; onChange: (v: LLMConfig) => void }) {
  const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0].name);
  const [modelInput, setModelInput] = useState(value.model);
  const [baseUrlInput, setBaseUrlInput] = useState(value.baseUrl);
  const [apiKeyInput, setApiKeyInput] = useState(value.apiKey);
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setModelInput(value.model);
    setBaseUrlInput(value.baseUrl);
    setApiKeyInput(value.apiKey);
  }, [value]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        setBaseUrlInput(cfg.baseUrl || "");
        setModelInput(cfg.model || "");
        if (cfg.baseUrl?.includes("openrouter")) setSelectedProvider("OpenRouter");
        else if (cfg.baseUrl?.includes("groq")) setSelectedProvider("Groq");
        else if (cfg.baseUrl) setSelectedProvider("Custom (OpenAI-compatible)");
        else setSelectedProvider("LM Studio (local)");
      })
      .catch(() => {});
  }, []);

  const fetchModels = async () => {
    setFetching(true);
    setError("");
    setModels([]);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrlInput, apiKey: apiKeyInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to fetch models");
        return;
      }
      const list = data.data || data.models || [];
      const names = list.map((m: any) => m.id || m.model || m.name).filter(Boolean);
      setModels(names);
      if (names.length > 0 && !names.includes(modelInput)) {
        setModelInput(names[0]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  };

  const apply = () => {
    onChange({ baseUrl: baseUrlInput, apiKey: apiKeyInput, model: modelInput });
  };

  const selectProvider = (name: string) => {
    setSelectedProvider(name);
    const p = PROVIDERS.find((x) => x.name === name);
    if (p) {
      if (p.baseUrl) setBaseUrlInput(p.baseUrl);
      if (p.defaultModels?.[0]) setModelInput(p.defaultModels[0]);
    }
  };

  return (
    <div style={{ marginBottom: 12, padding: 12, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>LLM Provider (current: {value.model})</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {PROVIDERS.map((p) => (
          <button key={p.name} type="button" onClick={() => selectProvider(p.name)} style={{ padding: "6px 10px", borderRadius: 6, border: selectedProvider === p.name ? "2px solid #16a34a" : "1px solid #d1d5db", background: selectedProvider === p.name ? "#dcfce7" : "#fff", fontSize: 13, cursor: "pointer" }}>
            {p.name}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "#374151", display: "block", marginBottom: 4 }}>Base URL</label>
        <input value={baseUrlInput} onChange={(e) => setBaseUrlInput(e.target.value)} style={{ width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} placeholder="https://api.provider.com/v1" />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "#374151", display: "block", marginBottom: 4 }}>API Key (optional for local)</label>
        <input type="password" value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} style={{ width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} placeholder="sk-..." />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "#374151", display: "block", marginBottom: 4 }}>Model</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={modelInput} onChange={(e) => setModelInput(e.target.value)} list="model-list" style={{ flex: 1, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} placeholder="e.g. model-name" />
          <datalist id="model-list">
            {(models.length > 0 ? models : (PROVIDERS.find((p) => p.name === selectedProvider)?.defaultModels || [])).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button type="button" onClick={fetchModels} disabled={fetching} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #16a34a", background: "#16a34a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: fetching ? "not-allowed" : "pointer" }}>
            {fetching ? "Fetching..." : "Fetch Models"}
          </button>
          <button type="button" onClick={apply} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #16a34a", background: "#16a34a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Apply
          </button>
        </div>
        {error && <div style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{error}</div>}
      </div>
    </div>
  );
}
