# CLAUDE.md

Local Ops Chat — an AI Kubernetes incident assistant that runs entirely on this
machine. No Trigger.dev, no cloud. LLM inference comes from any OpenAI-compatible
provider (LM Studio, OpenRouter, Groq, etc.); cluster actions shell out to `kubectl`
against a local kind cluster.

## Layout
- `app/api/chat/route.ts` — the agent loop: `streamText` + `clusterTools` + HITL.
- `lib/model.ts` — Generic OpenAI-compatible provider (env-driven).
- `lib/tools.ts` — read-only + HITL-gated kubectl tools.
- `lib/agent.ts` — system prompt + max steps.
- `app/components/chat.tsx` — `useChat` + `DefaultChatTransport`, approval cards.

## Run / verify
```bash
cp .env.example .env.local          # set LLM_MODEL/LM_STUDIO_MODEL + KUBE_CONTEXT
npm install
npm run typecheck                   # must pass
npm run build                       # must pass
npm run dev                         # http://localhost:3000
```
Bring up the demo workload (creates the kind cluster if missing):
```bash
../phase1-local-cluster/up.sh
```

## Conventions
- Config comes from environment variables only (see `.env.example`).
- Tools without `execute` (`propose*`) are the human-in-the-loop gate; the UI
  resolves them with `addToolOutput` and auto-resends.
- Keep the system prompt and tool descriptions explicit about the
  propose → approve → mutate sequence.
