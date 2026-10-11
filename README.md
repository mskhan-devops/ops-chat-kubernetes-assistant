# Local AI Ops Chat Agent for Kubernetes

An AI incident assistant that chats about your Kubernetes cluster, investigates
on its own (read-only `kubectl`), and **cannot touch anything without a human
clicking Approve**. It runs entirely on your machine — **no Trigger.dev, no
cloud services** — using a local **kind** cluster for workloads and a local
**LM Studio** server for LLM inference.

## What's in here

| Folder / file | What it is |
|---|---|
| `phase2-chat-agent/` | The agent: Next.js chat UI + local `/api/chat` agent loop + kubectl tools. Start with `STEPS.md`. |
| `phase1-local-cluster/` | A **kind** demo stack (`redis`, `orders`, `payments`) where `payments-1` deliberately OOM-crashes — the incident the agent fixes. `./up.sh` brings it up. |
| `*.html` | The original animated architecture / story diagrams (kept for reference). |

## Run it yourself

**1. Start LM Studio** with a tool-calling model loaded and the local server on
`http://localhost:1234/v1`. Note the model id (`GET /v1/models`).

**2. Bring up the demo cluster** (uses your existing kind cluster, or creates one):
```bash
phase1-local-cluster/up.sh
```

**3. Run the agent:**
```bash
cd phase2-chat-agent
npm install
# cp .env.example .env.local     # then set LM_STUDIO_MODEL + KUBE_CONTEXT
npm run dev                    # http://localhost:3000
```

Ask: **"why is payments crashing?"** — the agent reads pods and logs, proposes a
fix, and waits for your ✅ before running `kubectl delete` / patching the memory
limit.

## Configuration

All configuration is environment variables in `.env.local` (see
`phase2-chat-agent/.env.example`):

| Variable | Purpose |
|---|---|
| `LM_STUDIO_BASE_URL` | LM Studio OpenAI-compatible endpoint (default `http://localhost:1234/v1`) |
| `LM_STUDIO_API_KEY` | Any value; LM Studio ignores it |
| `LM_STUDIO_MODEL` | Model id to use, e.g. `frog` |
| `KUBE_CONTEXT` | kube context, e.g. `kind-my-cluster` (blank = current) |
| `KUBE_NAMESPACE` | Namespace of the demo stack (default `demo`) |
| `KUBECTL_BIN` | kubectl binary (default `kubectl`) |
| `USE_REAL_CLUSTER` | `true` → real kubectl; `false` → mock cluster data |
| `AGENT_MAX_STEPS` | Max LLM/tool steps per turn (default `15`) |

## How it works

- **Local agent loop** — `app/api/chat/route.ts` runs `streamText` with the
  kubectl tools; the browser holds conversation history and streams tokens back.
- **Human-in-the-loop** — mutations are gated behind no-execute "propose" tools
  (`proposeDeletion`, `proposeMemoryIncrease`); the UI renders Approve/Deny and
  resolves them with `addToolOutput` (`lib/tools.ts`, `app/components/chat.tsx`).
- **Local cluster** — the tools run `kubectl` against `KUBE_CONTEXT`.

Built with TypeScript, Next.js, the Vercel AI SDK and the local LM Studio server.


# Git commmands:

git add .
git commit -m "Your comments"
git push -u origin main


# Start command:
cd phase2-chat-agent
npm run dev