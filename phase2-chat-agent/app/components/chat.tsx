// ── Chat UI ──
//
// Plain AI SDK chat, no Trigger.dev. The browser holds the conversation and
// sends it to /api/chat; the HITL approval card resolves the no-execute
// proposeDeletion / proposeMemoryIncrease tool calls via addToolOutput, which
// re-sends the message so the agent continues (and only then runs the mutation).
//
// Readability rules (see the layout in this file):
//   * every turn is a MessageBubble — the user is tinted and right-aligned, the
//     assistant is plain and left-aligned, so turn boundaries are obvious;
//   * non-approval tool calls are *grouped* into a single collapsible
//     ToolActivity strip instead of one noisy line per call;
//   * tool names and states are shown in human terms ("Listed pods", ✓ / failed)
//     rather than the raw AI SDK values ("getPods · output-available").
// Propose* tool calls stay as visible, interactive ApprovalCards.

"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { objectiveKeys } from "@/lib/objectives";
import { formatCommand } from "@/lib/kubectl-args";

type AnyPart = {
  type?: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  text?: string;
};

// Auto-retry after a failed request: up to 3 attempts with exponential backoff.
// We retry on *any* error (transient fetch/network failures as well as server
// hiccups), then hand over to a manual "Retry" button if the budget is spent.
const AUTO_RETRY_LIMIT = 3;
const AUTO_RETRY_BASE_DELAY = 600;
const AUTO_RETRY_MAX_DELAY = 8000;

// Turn the model-facing tool names into something a human reads at a glance.
const TOOL_LABELS: Record<string, string> = {
  getNamespaces: "Listed namespaces",
  getPods: "Listed pods",
  getPodLogs: "Read pod logs",
  describePod: "Inspected pod",
  getEvents: "Read events",
  getServices: "Listed services",
  getDeployments: "Listed deployments",
  getStatefulSets: "Listed statefulsets",
  getDaemonSets: "Listed daemonsets",
  getNodes: "Listed nodes",
  getConfigMaps: "Listed configmaps",
  getSecrets: "Listed secrets",
  getIngresses: "Listed ingresses",
  getPvc: "Listed PVCs",
  getPv: "Listed PVs",
  getHpa: "Listed HPAs",
  getTopNodes: "Checked node usage",
  getTopPods: "Checked pod usage",
  getMetrics: "Read metrics",
  deletePod: "Deleted pod",
  setMemoryLimit: "Set memory limit",
  scaleWorkload: "Scaled workload",
  rolloutRestart: "Restarted rollout",
  applyManifest: "Applied manifest",
  deleteResource: "Deleted resource",
  execCommand: "Ran command in pod",
  portForward: "Started port-forward",
};

const labelFor = (name: string) => TOOL_LABELS[name] ?? name;

const toolNameOf = (part: AnyPart) => (part.type ?? "").slice("tool-".length);

// The full prose of an assistant turn, as raw markdown — this is what the
// "Copy answer" button puts on the clipboard.
function assistantText(parts: AnyPart[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n\n")
    .trim();
}

const isRunning = (part: AnyPart) =>
  part.state === "input-streaming" || part.state === "input-available";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Flatten react-markdown's children back to plain text so a fenced code block
// can be copied verbatim.
function reactText(node: ReactNode): string {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactText).join("");
  if (typeof node === "object" && "props" in node) {
    return reactText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;

  const copy = async () => {
    // Modern async Clipboard API first, then the legacy textarea +
    // execCommand fallback (needed in non-secure contexts or when the
    // Clipboard API is unavailable/rejected).
    const toClipboard = async (): Promise<boolean> => {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          // fall through to the legacy path below
        }
      }
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.left = "0";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    };

    if (await toClipboard()) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <button type="button" className="copy-btn" onClick={copy}>
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function MarkdownText({ children }: { children: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Wide kubectl tables must scroll inside the bubble, not stretch it.
          table: ({ node, ...props }) => (
            <div className="table-wrap">
              <table {...props} />
            </div>
          ),
          // Fenced code gets a copy button (the agent prints commands/manifests).
          pre: ({ node, children, ...props }) => (
            <div className="code-block">
              <CopyButton text={reactText(children)} />
              <pre {...props}>{children}</pre>
            </div>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

// One expandable row describing a single tool call (what it did + the exact
// kubectl command + raw output).
function ToolRow({ part, command }: { part: AnyPart; command: string }) {
  const name = toolNameOf(part);
  const running = isRunning(part);
  const failed = part.state === "output-error";
  const output = part.output;
  // While the server-side execute runs — kubectl can block for minutes on a
  // rollout — show a human-readable "still working" hint instead of a bare
  // "running…" so the UI never looks frozen.
  const hint = part.state === "input-streaming"
    ? "preparing…"
    : command
      ? "Executing command…"
      : "Waiting for results…";
  // The exact command is only useful once the model has finished writing it
  // (i.e. during execution), so show it while running, not while typing it.
  const showCmd = command && (!running || part.state !== "input-streaming");

  return (
    <li className={`activity-item${running ? " working" : ""}${failed ? " fail" : ""}`}>
      <div className="activity-item-head">
        {running ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <span className="activity-icon" aria-hidden="true">
            {failed ? "✕" : "✓"}
          </span>
        )}
        <span className="activity-item-name">{labelFor(name)}</span>
        <code className="activity-item-tool">{name}</code>
      </div>
      {showCmd && (
        <div className="activity-cmd">
          <span className="activity-cmd-label">cmd</span>
          <code>{command}</code>
        </div>
      )}
      {failed && part.errorText && (
        <pre className="activity-item-detail error">{part.errorText}</pre>
      )}
      {!failed && !running && output !== undefined && output !== "" && (
        <pre className="activity-item-detail">{String(output)}</pre>
      )}
      {running && (
        <div className="activity-item-hint">
          <span className="activity-item-hint-dot" aria-hidden="true" /> {hint}
        </div>
      )}
    </li>
  );
}

// All non-approval tool calls of a turn, collapsed into a single summary strip.
// Open state is owned by the Chat so one toggle can expand/collapse every strip.
function ToolActivity({
  parts,
  open,
  onToggle,
  commandOf,
}: {
  parts: AnyPart[];
  open: boolean;
  onToggle: () => void;
  commandOf: (part: AnyPart) => string;
}) {
  if (parts.length === 0) return null;

  const running = parts.some(isRunning);
  const failed = parts.some((p) => p.state === "output-error");

  const labels = Array.from(new Set(parts.map((p) => labelFor(toolNameOf(p)))));
  const summary =
    labels.slice(0, 3).join(", ") +
    (labels.length > 3 ? ` +${labels.length - 3} more` : "");

  // Which step is mid-flight right now, in human terms? This is shown on the
  // (possibly collapsed) toggle so the user always sees what the agent is doing
  // during a slow execute (e.g. kubectl rollout waiting), not just a spinner.
  const active = parts.filter(isRunning);
  const activeLabels = Array.from(new Set(active.map((p) => labelFor(toolNameOf(p)))));
  const hasCommand = active.some((p) => commandOf(p));
  const activeStatus = active.every((p) => p.state === "input-streaming")
    ? "preparing…"
    : hasCommand
      ? "Executing command…"
      : "Waiting for results…";

  return (
    <div className={`activity${open ? " open" : ""}`}>
      <button
        type="button"
        className="activity-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="chev" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        {running ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <span className={`activity-icon${failed ? " fail" : " ok"}`} aria-hidden="true">
            {failed ? "✕" : "✓"}
          </span>
        )}
        <span className="activity-count">
          {parts.length} {parts.length === 1 ? "step" : "steps"}
        </span>
        <span className="activity-summary">· {summary}</span>
      </button>
      {running && activeLabels.length > 0 && (
        <div className="activity-now" role="status" aria-live="polite">
          <span className="activity-item-hint-dot" aria-hidden="true" />
          <span className="activity-now-label">working</span>
          <span className="activity-now-detail">
            {activeLabels.join(", ")} — {activeStatus}
          </span>
        </div>
      )}
      {open && (
        <ul className="activity-list">
          {parts.map((p, i) => (
            <ToolRow key={i} part={p} command={commandOf(p)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function approvalSummary(toolName: string, input: Record<string, unknown>) {
  switch (toolName) {
    case "proposeDeletion":
      return (
        <>
          delete pod <code>{String(input.pod)}</code> in{" "}
          <code>{String(input.namespace)}</code>
        </>
      );
    case "proposeMemoryIncrease":
      return (
        <>
          raise memory of <code>{String(input.workload)}</code> ({String(input.kind)}) in{" "}
          <code>{String(input.namespace)}</code> to <code>{String(input.memory)}</code>
        </>
      );
    case "proposeScale":
      return (
        <>
          scale <code>{String(input.workload)}</code> ({String(input.kind)}) in{" "}
          <code>{String(input.namespace)}</code> to {String(input.replicas)} replicas
        </>
      );
    case "proposeRolloutRestart":
      return (
        <>
          restart rollout <code>{String(input.workload)}</code> ({String(input.kind)}) in{" "}
          <code>{String(input.namespace)}</code>
        </>
      );
    case "proposeApply":
      return <>apply manifest in <code>{String(input.namespace || "default")}</code></>;
    case "proposeDeleteResource":
      return (
        <>
          delete <code>{String(input.kind)}</code>/<code>{String(input.name)}</code>
          {input.namespace ? (
            <>
              {" "}in <code>{String(input.namespace)}</code>
            </>
          ) : null}
        </>
      );
    default:
      return <>approve {toolName}</>;
  }
}

// HITL approval card. Rendered for propose* parts only — never grouped away.
function ApprovalCard({
  part,
  deniedEarlier,
  busy,
  onResolve,
  onOther,
}: {
  part: AnyPart;
  deniedEarlier: boolean;
  busy: boolean;
  onResolve: (approved: boolean) => void;
  onOther: (text: string) => void;
}) {
  const toolName = toolNameOf(part);
  const input = (part.input ?? {}) as Record<string, unknown>;
  const [showOther, setShowOther] = useState(false);
  const [otherText, setOtherText] = useState("");

  // The model streams the tool input token-by-token; keep the card inert until
  // the arguments are complete so we never show half-written details.
  if (part.state === "input-streaming") {
    return (
      <div className="approval pending" aria-busy="true">
        <strong>⏳ Approval needed</strong>
        <div className="approval-reason">
          <span className="spinner" aria-hidden="true" /> Preparing details, please wait…
        </div>
        <div className="approval-actions">
          <button className="approve-btn" disabled>✅ Approve</button>
          <button className="deny-btn" disabled>❌ Deny</button>
          <button className="other-btn" disabled>💬 Something else on mind?</button>
        </div>
      </div>
    );
  }

  if (part.state === "input-available") {
    if (deniedEarlier) {
      return <p className="tool muted">❌ Already denied — this change was skipped</p>;
    }
    return (
      <div className="approval">
        <strong>⚠ Approval needed</strong>
        <div className="approval-summary">{approvalSummary(toolName, input)}</div>
        {typeof input.reason === "string" && input.reason && (
          <div className="approval-reason">{input.reason}</div>
        )}
        <div className="approval-actions">
          <button className="approve-btn" disabled={busy} onClick={() => onResolve(true)}>✅ Approve</button>
          <button className="deny-btn" disabled={busy} onClick={() => onResolve(false)}>❌ Deny</button>
          <button
            className="other-btn"
            disabled={busy}
            aria-expanded={showOther}
            onClick={() => setShowOther((s) => !s)}
          >
            💬 Something else on mind?
          </button>
        </div>
        {showOther && (
          <div className="approval-other">
            <textarea
              autoFocus
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends the redirect; Shift+Enter inserts a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (otherText.trim() && !busy) onOther(otherText.trim());
                }
              }}
              rows={2}
              placeholder={
                'What would you prefer instead — e.g. "don\u2019t delete it, just bump the memory"'
              }
            />
            <div className="approval-other-actions">
              <button
                className="other-btn"
                disabled={busy || !otherText.trim()}
                onClick={() => onOther(otherText.trim())}
              >
                Send
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => {
                  setShowOther(false);
                  setOtherText("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const output = part.state === "output-available"
    ? ((part.output ?? {}) as { approved?: boolean; cancelled?: boolean })
    : {};
  const cancelled = output.cancelled === true;
  const approved = !cancelled && output.approved === true;
  return (
    <div className={`approval-result ${approved ? "ok" : cancelled ? "neutral" : "no"}`}>
      {approved
        ? "✅ Approved"
        : cancelled
          ? "🔁 Redirected"
          : "❌ Denied"}{" "}
      · {approvalSummary(toolName, input)}
    </div>
  );
}

// A single turn: avatar + bubble. Activity strip is hoisted above the prose so
// the narrative text stays unbroken.
function MessageBubble({
  role,
  parts,
  ts,
  activityOpen,
  onToggleActivity,
  isDeniedObjective,
  busy,
  onResolve,
  onOther,
  copyEnabled,
  commandOf,
}: {
  role: string;
  parts: AnyPart[];
  ts?: number;
  activityOpen: boolean;
  onToggleActivity: () => void;
  isDeniedObjective: (toolName: string, input: unknown) => boolean;
  busy: boolean;
  onResolve: (part: AnyPart, approved: boolean) => void;
  onOther: (part: AnyPart, text: string) => void;
  copyEnabled: boolean;
  commandOf: (part: AnyPart) => string;
}) {
  const activity = parts.filter(
    (p) => p.type?.startsWith("tool-") && !p.type.startsWith("tool-propose"),
  );
  const answer = role === "assistant" ? assistantText(parts) : "";

  return (
    <div className={`msg ${role}`}>
      <span className="avatar" aria-hidden="true">
        {role === "user" ? "🧑" : "🤖"}
      </span>
      <div className="bubble">
        <div className="msg-meta">
          <span className="msg-name">{role === "user" ? "You" : "Ops agent"}</span>
          {ts ? <span className="msg-time">{formatTime(ts)}</span> : null}
        </div>
        <ToolActivity parts={activity} open={activityOpen} onToggle={onToggleActivity} commandOf={commandOf} />
        <div className="parts">
          {parts.map((part, i) => {
            if (part.type === "text") {
              return <MarkdownText key={i}>{part.text ?? ""}</MarkdownText>;
            }
            if (part.type?.startsWith("tool-propose") && isToolUIPart(part as never)) {
              const toolName = toolNameOf(part);
              return (
                <ApprovalCard
                  key={i}
                  part={part}
                  deniedEarlier={isDeniedObjective(toolName, part.input)}
                  busy={busy}
                  onResolve={(approved) => onResolve(part, approved)}
                  onOther={(text) => onOther(part, text)}
                />
              );
            }
            // Non-approval tool calls are already rendered by ToolActivity.
            return null;
          })}
        </div>
        {copyEnabled && answer && (
          <div className="msg-copy">
            <CopyButton text={answer} />
          </div>
        )}
      </div>
    </div>
  );
}

export function Chat({ kubeBin = "kubectl", kubeContext = "" }: { kubeBin?: string; kubeContext?: string }) {
  // Suppress the propose-tool auto-resend for a SINGLE addToolOutput. Used by
  // "Something else on mind?" so the custom user message — not the bare denial —
  // is what restarts the agent loop.
  const suppressAutoSendRef = useRef(false);
  // Auto-retry bookkeeping: how many consecutive failures we've absorbed, the
  // pending retry timer, and a small banner state shown while retrying.
  const autoRetryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryState, setRetryState] = useState<{
    attempt: number;
    max: number;
    exhausted: boolean;
  } | null>(null);

  const { messages, sendMessage, addToolOutput, stop, status, setMessages, error, clearError, regenerate } =
    useChat({
      transport: new DefaultChatTransport({ api: "/api/chat" }),
      // once the human answers a propose tool call, re-send so the agent picks up
      // the decision and continues the turn
      sendAutomaticallyWhen: (options) => {
        if (suppressAutoSendRef.current) {
          suppressAutoSendRef.current = false;
          return false;
        }
        return lastAssistantMessageIsCompleteWithToolCalls(options);
      },
      // Give back the auto-retry budget only when a request genuinely succeeds;
      // errors/aborts leave it spent so a bad stretch can't loop forever.
      onFinish: ({ isError, isAbort }) => {
        if (!isError && !isAbort) {
          autoRetryCountRef.current = 0;
          setRetryState(null);
        }
      },
      // Pace the published messages snapshot. Without this, useChat's
      // useSyncExternalStore re-reads a fresh messages array on every stream
      // chunk, and when many chunks land faster than React can commit (fast
      // local model, multi-step kubectl loops) a forced synchronous re-render
      // per chunk trips React's "Maximum update depth exceeded" (vercel/ai
      // #6166). The SDK publishes a throttled snapshot + terminal flush on
      // `ready`, so 50ms pacing keeps streaming smooth without the loop.
      experimental_throttle: 50,
      onError: (error) => console.error("[ops-chat] useChat error:", error),
    });
  // JS-side snapshot of the latest messages, for use inside the retry path
  // (where the closure may be slightly older than the last streamed chunk).
  const latestMessagesRef = useRef(messages);
  const commandOf = (part: AnyPart) =>
    formatCommand(toolNameOf(part), (part.input ?? {}) as Record<string, unknown>, kubeBin, kubeContext);
  const [input, setInput] = useState("");
  // Timestamps are stamped client-side the first time a message id appears;
  // the UIMessage itself carries no clock.
  const [timestamps, setTimestamps] = useState<Record<string, number>>({});
  // Global open/closed state for every ToolActivity strip.
  const [activityOpen, setActivityOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // User-draggable chat width. null = let CSS decide (820px default).
  const chatRef = useRef<HTMLDivElement>(null);
  const [chatWidth, setChatWidth] = useState<number | null>(null);
  // Objectives (changes) the human has already denied, and proposal ids we have
  // auto-resolved so we don't dispatch the same denial twice.
  const deniedKeysRef = useRef<Set<string>>(new Set());
  const autoDeniedIdsRef = useRef<Set<string>>(new Set());

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = chatRef.current?.getBoundingClientRect().width ?? 820;

    const move = (ev: PointerEvent) => {
      const vw = window.innerWidth;
      const maxW = Math.min(1400, vw - 48);
      setChatWidth(Math.min(maxW, Math.max(360, startW + (ev.clientX - startX))));
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  // Share the width with the page header via a CSS variable so the title stays
  // aligned with the chat box at every dragged size.
  useEffect(() => {
    const px = chatWidth === null ? 820 : chatWidth;
    document.documentElement.style.setProperty("--chat-width", `${px}px`);
  }, [chatWidth]);

  // Follow the stream only while the user is already near the bottom, so a
  // manual scroll-up to read history isn't yanked back.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Stamp each message as it first arrives.
  useEffect(() => {
    setTimestamps((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const m of messages) {
        if (!(m.id in next)) {
          next[m.id] = Date.now();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [messages]);

  // Rebuild the set of denied objectives from history. A denial is scoped to the
  // change, so we key it via objectiveKeys() (shared with the server).
  useEffect(() => {
    const denied = new Set<string>();
    for (const m of messages) {
      for (const part of m.parts) {
        const p = part as AnyPart;
        if (!p.type?.startsWith("tool-propose")) continue;
        if (p.state !== "output-available") continue;
        // A "cancelled" proposal (via Something else on mind?) is neutral — it
        // must not be remembered as a denial, so the same change can be
        // proposed and approved again later.
        if ((p.output as { cancelled?: boolean } | undefined)?.cancelled === true) continue;
        if ((p.output as { approved?: boolean } | undefined)?.approved !== false) continue;
        const toolName = toolNameOf(p);
        for (const key of objectiveKeys(toolName, (p.input ?? {}) as Record<string, unknown>)) {
          denied.add(key);
        }
      }
    }
    deniedKeysRef.current = denied;
  }, [messages]);

  const isDeniedObjective = (toolName: string, input: unknown) =>
    objectiveKeys(toolName, (input ?? {}) as Record<string, unknown>).some((k) =>
      deniedKeysRef.current.has(k),
    );

  // A denied objective must not be re-offered. If the model re-proposes the same
  // change through any tool, resolve it as denied automatically instead of
  // showing another approval card, then let the auto-resend teach the agent that
  // the denial still stands.
  useEffect(() => {
    if (deniedKeysRef.current.size === 0) return;
    // Never resolve proposals while a request is in flight: the SDK's
    // auto-resend chains state updates off addToolOutput, and doing that from
    // inside this messages-driven effect can cascade into a synchronous
    // update loop ("Maximum update depth exceeded"). Denials only apply to
    // proposals the model is parked on, i.e. status is "ready".
    if (status === "streaming" || status === "submitted") return;
    for (const m of messages) {
      for (const part of m.parts) {
        const p = part as AnyPart;
        if (!p.type?.startsWith("tool-propose")) continue;
        if (p.state !== "input-available" || !p.toolCallId) continue;
        if (autoDeniedIdsRef.current.has(p.toolCallId)) continue;
        const toolName = toolNameOf(p);
        if (!isDeniedObjective(toolName, p.input)) continue;
        autoDeniedIdsRef.current.add(p.toolCallId);
        // Defer out of the effect flush so the auto-resend's state updates land
        // in a clean commit, not nested inside this one.
        const id = p.toolCallId;
        setTimeout(() => {
          addToolOutput({ tool: toolName, toolCallId: id, output: { approved: false } });
        }, 0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, addToolOutput, status]);

  const resolveApproval = (part: AnyPart, approved: boolean) => {
    if (!part.toolCallId) return;
    addToolOutput({
      tool: toolNameOf(part),
      toolCallId: part.toolCallId,
      output: { approved },
    });
  };

  // "Something else on mind?": the user doesn't approve/deny but wants to steer
  // the agent with their own words. We resolve the pending proposal as
  // CANCELLED (a neutral, non-decision outcome) so nothing executes, the change
  // is not recorded as denied, and the agent can re-propose it later if asked.
  // The human's text then goes out as a normal user message. The auto-resend is
  // suppressed for the cancellation so it doesn't race the user message.
  const resolveOther = async (part: AnyPart, text: string) => {
    if (!part.toolCallId || !text.trim()) return;
    suppressAutoSendRef.current = true;
    try {
      await addToolOutput({
        tool: toolNameOf(part),
        toolCallId: part.toolCallId,
        output: { cancelled: true },
      });
      cancelRetry();
      await sendMessage({ text });
    } catch (err) {
      console.error("[ops-chat] something-else flow failed:", err);
    } finally {
      suppressAutoSendRef.current = false;
    }
  };

  // Cancel a pending auto-retry (e.g. the user typed something new) and clear
  // its budget, since a fresh request supersedes the failed one.
  const cancelRetry = () => {
    if (retryTimerRef.current != null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    autoRetryCountRef.current = 0;
    setRetryState(null);
  };

  // Pick up after a failure without starting over. The server is stateless and
  // gets the whole history on every POST, so we trim the *current* assistant
  // message back to its last completed step and resend it — the model continues
  // from there, and everything already accomplished (reads, earlier steps) is
  // preserved. If there is no reusable partial turn, fall back to re-delivering
  // the last user request.
  const continueAfterError = useCallback(() => {
    const msgs = latestMessagesRef.current;
    const last = msgs[msgs.length - 1];
    if (last && last.role === "assistant") {
      const parts = last.parts as AnyPart[];
      // Keep everything before the last step-start: that boundary marks the
      // step that was mid-flight when the request died, so its parts may be
      // half-written and must be dropped. Completed earlier steps stay.
      const lastStepStart = parts.findLastIndex((p) => p.type === "step-start");
      const kept = lastStepStart > 0 ? parts.slice(0, lastStepStart) : [];
      if (kept.length > 0) {
        setMessages([
          ...msgs.slice(0, -1),
          { ...last, parts: kept } as (typeof msgs)[number],
        ]);
        void sendMessage().catch((e) => console.error("[ops-chat] resume-after-error failed:", e));
        return;
      }
    }
    void regenerate().catch((e) => console.error("[ops-chat] retry regenerate failed:", e));
  }, [sendMessage, setMessages, regenerate]);

  const manualRetry = () => {
    cancelRetry();
    continueAfterError();
  };

  // Keep a fresh copy of messages for continueAfterError (which is memoized and
  // therefore doesn't see the latest closure values).
  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  // Auto-retry after any failure: a few attempts, exponential backoff. The
  // budget is only reset by a successful onFinish, so a broken sequence can't
  // loop forever — it eventually surfaces the error banner with a manual
  // "Retry" button.
  useEffect(() => {
    if (status !== "error" || !error) return;
    if (retryTimerRef.current != null) return; // already scheduled
    if (autoRetryCountRef.current >= AUTO_RETRY_LIMIT) {
      setRetryState({ attempt: AUTO_RETRY_LIMIT, max: AUTO_RETRY_LIMIT, exhausted: true });
      return;
    }
    autoRetryCountRef.current += 1;
    const attempt = autoRetryCountRef.current;
    setRetryState({ attempt, max: AUTO_RETRY_LIMIT, exhausted: false });
    const delay = Math.min(AUTO_RETRY_MAX_DELAY, AUTO_RETRY_BASE_DELAY * 2 ** (attempt - 1));
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      continueAfterError();
    }, delay);
    return () => {
      if (retryTimerRef.current != null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, error, continueAfterError]);

  const submitInput = () => {
    if (!input.trim()) return;
    cancelRetry();
    sendMessage({ text: input });
    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (status !== "streaming" && status !== "submitted") submitInput();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  // While a turn is running, show a spinner for the model itself unless a tool
  // line is already showing its own in-progress spinner. This covers BOTH the
  // "submitted" state (request posted, waiting for the first token — the slow
  // part with a local model) and "streaming".
  const lastParts = (messages[messages.length - 1]?.parts ?? []) as AnyPart[];
  const lastWorkingTool = lastParts.some((p) => isToolUIPart(p as never) && isRunning(p));
  // Don't keep a "thinking…" bubble pinned below an answer that is already
  // streaming — that made short post-action summaries feel like the agent was
  // stuck "thinking" the whole time. The bubble is only for real gaps: waiting
  // for the first token, or waiting for the model between tool calls.
  const lastPartShown = lastParts[lastParts.length - 1];
  const streamingText =
    lastPartShown?.type === "text" && (lastPartShown.text ?? "").length > 0;
  const llmWorking =
    status === "submitted" || (status === "streaming" && !lastWorkingTool && !streamingText);
  const llmWorkingLabel = status === "submitted" ? "Waiting for LLM response…" : "thinking…";
  // A request is in flight; approval buttons must be inert until it settles.
  const busy = status === "streaming" || status === "submitted";

  // Only offer the global toggle once there is something to collapse.
  const hasActivity = messages.some((m) =>
    (m.parts as AnyPart[]).some(
      (p) => p.type?.startsWith("tool-") && !p.type.startsWith("tool-propose"),
    ),
  );

  return (
    <div className="chat" ref={chatRef}>
      <div className="chat-resize" role="separator" aria-orientation="vertical"
        aria-label="Resize chat width" onPointerDown={startResize} />
      {hasActivity && (
        <div className="chat-toolbar">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setActivityOpen((o) => !o)}
            aria-expanded={activityOpen}
          >
            {activityOpen ? "▾ Hide tool steps" : "▸ Show tool steps"}
          </button>
        </div>
      )}
      <div className="messages" ref={messagesRef}>
        {messages.map((m, mi) => (
          <MessageBubble
            key={`${m.id}-${mi}`}
            role={m.role}
            parts={m.parts as AnyPart[]}
            ts={timestamps[m.id]}
            activityOpen={activityOpen}
            onToggleActivity={() => setActivityOpen((o) => !o)}
            isDeniedObjective={isDeniedObjective}
            busy={busy}
            onResolve={resolveApproval}
            onOther={resolveOther}
            copyEnabled={!(status === "streaming" || status === "submitted") || mi !== messages.length - 1}
            commandOf={commandOf}
          />
        ))}
        {llmWorking && (
          <div className="msg assistant">
            <span className="avatar" aria-hidden="true">
              🤖
            </span>
            <div className="bubble">
              <p className="tool working">
                <span className="spinner" aria-hidden="true" /> {llmWorkingLabel}
              </p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span>
            {retryState && !retryState.exhausted
              ? `⚠ ${error.message || "The request failed."} — retrying (${retryState.attempt}/${retryState.max})…`
              : `⚠ ${error.message || "The request failed."}`}
          </span>
          <div className="error-banner-actions">
            <button type="button" className="retry-btn" onClick={manualRetry}>
              ↻ Retry
            </button>
            <button
              type="button"
              onClick={() => {
                cancelRetry();
                clearError();
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitInput();
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder='Try: "why is payments crashing?" — Shift+Enter for a new line'
        />
        <button type="submit" disabled={status === "streaming" || status === "submitted"}>
          Send
        </button>
        {status === "streaming" && (
          <button type="button" onClick={stop}>
            ⏹ Stop
          </button>
        )}
        <button type="button" onClick={() => setMessages([])}>
          🗑️ Clear
        </button>
      </form>
    </div>
  );
}
