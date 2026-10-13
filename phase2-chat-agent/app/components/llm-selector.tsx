"use client";

import { useEffect, useState } from "react";

export type LLMConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const PROVIDERS = [
  {
    name: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    defaultModels: ["local-model", "llama-3.1-8b-instruct", "llama-3.2-3b-instruct"],
  },
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModels: [
      "meta-llama/llama-3.1-8b-instruct:free",
      "meta-llama/llama-3-8b-instruct:free",
      "google/gemma-2-9b-it:free",
      "mistralai/mistral-small-3.1-24b-instruct:free",
      "deepseek/deepseek-chat-v3-0324:free",
    ],
  },
  {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModels: [
      "llama-3.1-8b-instant",
      "llama-3.3-70b-versatile",
      "mistral-saba-24b",
      "qwen/qwen3-32b",
    ],
  },
  {
    name: "Custom (OpenAI-compatible)",
    baseUrl: "",
    defaultModels: ["your-model-name"],
  },
];

export function LLMSelector({
  value,
  onChange,
}: {
  value: LLMConfig;
  onChange: (v: LLMConfig) => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0].name);
  const [modelInput, setModelInput] = useState(value.model);
  const [baseUrlInput, setBaseUrlInput] = useState(value.baseUrl);
  const [apiKeyInput, setApiKeyInput] = useState(value.apiKey);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setModelInput(value.model);
    setBaseUrlInput(value.baseUrl);
    setApiKeyInput(value.apiKey);
  }, [value]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        setBaseUrlInput(cfg.baseUrl);
        setModelInput(cfg.model);
        if (cfg.baseUrl?.includes("openrouter")) {
          setSelectedProvider("OpenRouter");
        } else if (cfg.baseUrl?.includes("groq")) {
          setSelectedProvider("Groq");
        } else {
          setSelectedProvider("LM Studio (local)");
        }
      })
      .catch(() => {});
  }, []);

  const apply = () => {
    onChange({
      baseUrl: baseUrlInput,
      apiKey: apiKeyInput,
      model: modelInput,
    });
  };

  const selectProvider = (name: string) => {
    setSelectedProvider(name);
    const p = PROVIDERS.find((x) => x.name === name);
    if (p) {
      if (p.baseUrl) {
        setBaseUrlInput(p.baseUrl);
      }
      if (p.defaultModels?.[0]) {
        setModelInput(p.defaultModels[0]);
      }
    }
  };

  const currentProvider = PROVIDERS.find((x) => x.name === selectedProvider);

  return (
    <div style={{ marginBottom: 12, padding: 12, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
        LLM Provider (current: {value.model})
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {PROVIDERS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => selectProvider(p.name)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: selectedProvider === p.name ? "2px solid #16a34a" : "1px solid #d1d5db",
              background: selectedProvider === p.name ? "#dcfce7" : "#fff",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 12, color: "#374151", display: "block", marginBottom: 4 }}>Model</label>
          <input
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            list="model-list"
            style={{ width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }}
            placeholder="e.g. meta-llama/llama-3-8b-instruct:free"
          />
          {currentProvider?.defaultModels && (
            <datalist id="model-list">
              {currentProvider.defaultModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", fontSize: 12, cursor: "pointer", marginTop: 18 }}
        >
          {showAdvanced ? "Hide" : "Advanced"}
        </button>

        <button
          type="button"
          onClick={apply}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #16a34a", background: "#16a34a", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 18 }}
        >
          Apply
        </button>
      </div>

      {showAdvanced && (
        <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
          <div>
            <label style={{ fontSize: 12, color: "#374151", display: "block", marginBottom: 4 }}>Base URL</label>
            <input
              value={baseUrlInput}
              onChange={(e) => setBaseUrlInput(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }}
              placeholder="https://api.provider.com/v1"
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#374151", display: "block", marginBottom: 4 }}>API Key (optional for local)</label>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }}
              placeholder="sk-..."
            />
          </div>
        </div>
      )}
    </div>
  );
}
