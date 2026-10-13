# Phase 2 — Local Ops Chat (no Trigger.dev)

The agent now runs as a plain Next.js app: the browser holds the conversation,
`app/api/chat/route.ts` runs the `streamText` loop + kubectl tools, and LM Studio
provides inference locally.

## Files

| Concern | File |
|---|---|
| Chat UI + approval cards | `app/components/chat.tsx`, `app/page.tsx` |
| Agent endpoint (LLM loop) | `app/api/chat/route.ts` |
| LLM provider (OpenAI-compatible) | `lib/model.ts` |
| kubectl tools + HITL gates | `lib/tools.ts` |
| System prompt / step cap | `lib/agent.ts` |

## Commands

```bash
cp .env.example .env.local     # set LM_STUDIO_MODEL + KUBE_CONTEXT + KUBE_NAMESPACE
npm install
npm run dev                    # Next.js on http://localhost:3000
```

Requires LM Studio's local server running with a tool-calling model loaded.

## How it works

1. **Chat UI** sends the full message history to `/api/chat`.
2. **Agent loop** (`streamText`) calls read-only tools freely, and `propose*`
   tools (no `execute`) to ask the human before mutating.
3. **HITL** — the paused propose tool renders Approve/Deny; the UI resolves it
   with `addToolOutput`, which auto-resends so the agent continues and only then
   calls `deletePod` / `setMemoryLimit`.
4. **Cluster** — tools shell out to `kubectl` using `KUBE_CONTEXT`/`KUBE_NAMESPACE`.

## Demo beats

- Ask **"why is payments crashing?"** → agent reads pods + logs.
- Ask it to fix it → approval card appears → ✅ → tool runs (real kubectl if
  `USE_REAL_CLUSTER=true`).
- Set `USE_REAL_CLUSTER=false` to run the chat with mock cluster data instead.
