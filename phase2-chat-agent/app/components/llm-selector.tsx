"use client";

import { useEffect, useRef, useState } from "react";

export type LLMConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

type ProviderDef = {
  name: string;
  baseUrl: string;
  defaultModels: string[];
};

const PROVIDERS: ProviderDef[] = [
  { name: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", defaultModels: ["local-model", "my-chat-model", "llama-3.1-8b-instruct"] },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModels: ["meta-llama/llama-3.1-8b-instruct:free", "google/gemma-2-9b-it:free", "deepseek/deepseek-chat-v3-0324:free"] },
  { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModels: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"] },
  { name: "Custom (OpenAI-compatible)", baseUrl: "", defaultModels: ["your-model-name"] },
];

const STORAGE_KEY = "ops-chat-llm-providers";

function defaultConfigs(): Record<string, LLMConfig> {
  return Object.fromEntries(
    PROVIDERS.map((p) => [p.name, { baseUrl: p.baseUrl, apiKey: "", model: p.defaultModels[0] ?? "" }]),
  );
}

function loadStored(): { configs: Record<string, LLMConfig>; selected: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      configs: { ...defaultConfigs(), ...(parsed.configs || {}) },
      selected: typeof parsed.selected === "string" ? parsed.selected : PROVIDERS[0].name,
    };
  } catch {
    return null;
  }
}

export function LLMSelector({ value, onChange }: { value: LLMConfig; onChange: (v: LLMConfig) => void }) {
  const stored = useRef(loadStored());
  const [configs, setConfigs] = useState<Record<string, LLMConfig>>(
    stored.current?.configs ?? defaultConfigs(),
  );
  const [selectedProvider, setSelectedProvider] = useState(stored.current?.selected ?? PROVIDERS[0].name);
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [open, setOpen] = useState(false);

  const active = configs[selectedProvider] ?? { baseUrl: "", apiKey: "", model: "" };
  const seededRef = useRef(false);

  // Persist per-provider configs (each keeps its own API key).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ configs, selected: selectedProvider }));
      } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [configs, selectedProvider]);

  // Seed from the server-side configured provider once (on mount). Only when
  // the user has no saved per-provider config yet — otherwise their stored
  // keys/choices must win over the env defaults.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (stored.current) return;
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: { baseUrl?: string; apiKey?: string; model?: string }) => {
        if (!cfg.baseUrl) return;
        let target = "Custom (OpenAI-compatible)";
        const b = cfg.baseUrl.toLowerCase();
        if (b.includes("openrouter")) target = "OpenRouter";
        else if (b.includes("groq")) target = "Groq";
        else if (b.includes("localhost") || b.includes("127.0.0.1") || b.includes("0.0.0.0")) target = "LM Studio (local)";
        setConfigs((prev) => ({
          ...prev,
          [target]: {
            baseUrl: cfg.baseUrl ?? prev[target]?.baseUrl ?? "",
            apiKey: cfg.apiKey ?? prev[target]?.apiKey ?? "",
            model: cfg.model ?? prev[target]?.model ?? "",
          },
        }));
        setSelectedProvider(target);
      })
      .catch(() => {});
  }, []);

  // Auto-apply the selected provider's config so requests always go to that
  // provider with its own API key — no "Apply" step needed.
  useEffect(() => {
    onChange(configs[selectedProvider] ?? { baseUrl: "", apiKey: "", model: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider, active.baseUrl, active.apiKey, active.model]);

  const updateActive = (patch: Partial<LLMConfig>) => {
    setConfigs((prev) => ({ ...prev, [selectedProvider]: { ...prev[selectedProvider], ...patch } }));
  };

  const selectProvider = (name: string) => {
    setSelectedProvider(name);
    setModels([]);
    setError("");
    setPickerOpen(false);
  };

  const fetchModels = async () => {
    setFetching(true);
    setError("");
    setModels([]);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: active.baseUrl, apiKey: active.apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Failed to fetch models (${res.status})`);
        return;
      }
      const list = data.data || data.models || [];
      const names = list.map((m: any) => m.id || m.model || m.name).filter(Boolean);
      setModels(names);
      setPickerSearch("");
      if (names.length > 0) setPickerOpen(true);
      else setError("No models were returned by the provider.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  };

  const pickModel = (m: string) => {
    updateActive({ model: m });
    setPickerOpen(false);
    setError("");
  };

  const filteredModels = models.filter((m) =>
    pickerSearch ? m.toLowerCase().includes(pickerSearch.toLowerCase()) : true,
  );

  return (
    <div className="llm-panel">
      <button
        type="button"
        className="llm-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="llm-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="llm-title">LLM Provider</span>
        <span className="llm-current">
          <span className="llm-provider-badge">{selectedProvider}</span>
          <span className="llm-model-badge" title={value.model || "no model selected"}>
            {value.model || "no model selected"}
          </span>
        </span>
      </button>
      {open && (
      <div className="llm-body">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {PROVIDERS.map((p) => (
          <button key={p.name} type="button" onClick={() => selectProvider(p.name)} style={{ padding: "6px 10px", borderRadius: 6, border: selectedProvider === p.name ? "2px solid #16a34a" : "1px solid #d1d5db", background: selectedProvider === p.name ? "#dcfce7" : "#fff", fontSize: 13, cursor: "pointer" }}>
            {p.name}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "#374151", display: "block", marginBottom: 4 }}>Base URL</label>
        <input value={active.baseUrl} onChange={(e) => updateActive({ baseUrl: e.target.value })} style={{ width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} placeholder="https://api.provider.com/v1" />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "#374151", display: "block", marginBottom: 4 }}>
          API Key {selectedProvider === "LM Studio (local)" ? "(optional for local)" : `(${selectedProvider})`}
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input type={showKey ? "text" : "password"} value={active.apiKey} onChange={(e) => updateActive({ apiKey: e.target.value })} style={{ flex: 1, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} placeholder="sk-..." />
          <button type="button" onClick={() => setShowKey((s) => !s)} title={showKey ? "Hide API key" : "Show API key"} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {showKey ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "#374151", display: "block", marginBottom: 4 }}>Model</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={active.model} onChange={(e) => updateActive({ model: e.target.value })} list="model-list" style={{ flex: 1, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} placeholder="e.g. model-name" />
          <datalist id="model-list">
            {(models.length > 0 ? models : (PROVIDERS.find((p) => p.name === selectedProvider)?.defaultModels || [])).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button type="button" onClick={fetchModels} disabled={fetching} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #16a34a", background: "#16a34a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: fetching ? "not-allowed" : "pointer" }}>
            {fetching ? "Fetching..." : "Fetch Models"}
          </button>
        </div>
        {error && <div style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{error}</div>}
      </div>

      {pickerOpen && (
        <div onClick={() => setPickerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: 16, width: "min(520px, 90vw)", maxHeight: "70vh", display: "flex", flexDirection: "column", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Select a model ({models.length})</div>
            <input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} autoFocus placeholder="Search models…" style={{ padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, marginBottom: 8 }} />
            <div style={{ overflowY: "auto", flex: 1 }}>
              {filteredModels.length === 0 ? (
                <div style={{ fontSize: 13, color: "#6b7280", padding: 8 }}>No models match your search.</div>
              ) : (
                filteredModels.map((m) => (
                  <button key={m} type="button" onClick={() => pickModel(m)} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none", borderBottom: "1px solid #f3f4f6", background: "transparent", fontSize: 13, cursor: "pointer", color: "#111827" }}>
                    {m}
                  </button>
                ))
              )}
            </div>
            <button type="button" onClick={() => setPickerOpen(false)} style={{ marginTop: 10, padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  );
}