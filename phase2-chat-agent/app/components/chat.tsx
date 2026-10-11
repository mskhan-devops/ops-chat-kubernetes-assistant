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

import { useEffect, useRef, useState, type ReactNode } from "react";
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

type AnyPart = {
  type?: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  text?: string;
};

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
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — nothing useful to do */
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

// One expandable row describing a single tool call (what it did + raw output).
function ToolRow({ part }: { part: AnyPart }) {
  const name = toolNameOf(part);
  const running = isRunning(part);
  const failed = part.state === "output-error";
  const output = part.output;

  return (
    <li className={`activity-item${failed ? " fail" : ""}`}>
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
      {failed && part.errorText && (
        <pre className="activity-item-detail error">{part.errorText}</pre>
      )}
      {!failed && !running && output !== undefined && output !== "" && (
        <pre className="activity-item-detail">{String(output)}</pre>
      )}
      {running && <div className="activity-item-hint">running…</div>}
    </li>
  );
}

// All non-approval tool calls of a turn, collapsed into a single summary strip.
// Open state is owned by the Chat so one toggle can expand/collapse every strip.
function ToolActivity({
  parts,
  open,
  onToggle,
}: {
  parts: AnyPart[];
  open: boolean;
  onToggle: () => void;
}) {
  if (parts.length === 0) return null;

  const running = parts.some(isRunning);
  const failed = parts.some((p) => p.state === "output-error");

  const labels = Array.from(new Set(parts.map((p) => labelFor(toolNameOf(p)))));
  const summary =
    labels.slice(0, 3).join(", ") +
    (labels.length > 3 ? ` +${labels.length - 3} more` : "");

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
      {open && (
        <ul className="activity-list">
          {parts.map((p, i) => (
            <ToolRow key={i} part={p} />
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
  onResolve,
}: {
  part: AnyPart;
  deniedEarlier: boolean;
  onResolve: (approved: boolean) => void;
}) {
  const toolName = toolNameOf(part);
  const input = (part.input ?? {}) as Record<string, unknown>;

  // The model streams the tool input token-by-token; keep the card inert until
  // the arguments are complete so we never show half-written details.
  if (part.state === "input-streaming") {
    return (
      <div className="approval pending" aria-busy="true">
        <strong>⏳ Approval needed</strong>
        <div className="approval-reason">
          <span className="spinner" aria-hidden="true" /> Preparing details, please wait…
        </div>
        <div>
          <button disabled>✅ Approve</button>
          <button disabled>❌ Deny</button>
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
        <div>
          <button onClick={() => onResolve(true)}>✅ Approve</button>
          <button onClick={() => onResolve(false)}>❌ Deny</button>
        </div>
      </div>
    );
  }

  const approved =
    part.state === "output-available" && (part.output as { approved?: boolean })?.approved;
  return (
    <div className={`approval-result ${approved ? "ok" : "no"}`}>
      {approved ? "✅ Approved" : "❌ Denied"} · {approvalSummary(toolName, input)}
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
  onResolve,
}: {
  role: string;
  parts: AnyPart[];
  ts?: number;
  activityOpen: boolean;
  onToggleActivity: () => void;
  isDeniedObjective: (toolName: string, input: unknown) => boolean;
  onResolve: (part: AnyPart, approved: boolean) => void;
}) {
  const activity = parts.filter(
    (p) => p.type?.startsWith("tool-") && !p.type.startsWith("tool-propose"),
  );

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
        <ToolActivity parts={activity} open={activityOpen} onToggle={onToggleActivity} />
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
                  onResolve={(approved) => onResolve(part, approved)}
                />
              );
            }
            // Non-approval tool calls are already rendered by ToolActivity.
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

export function Chat() {
  const { messages, sendMessage, addToolOutput, stop, status, setMessages, error, clearError } =
    useChat({
      transport: new DefaultChatTransport({ api: "/api/chat" }),
      // once the human answers a propose tool call, re-send so the agent picks up
      // the decision and continues the turn
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onError: (error) => console.error("[ops-chat] useChat error:", error),
    });
  const [input, setInput] = useState("");
  // Timestamps are stamped client-side the first time a message id appears;
  // the UIMessage itself carries no clock.
  const [timestamps, setTimestamps] = useState<Record<string, number>>({});
  // Global open/closed state for every ToolActivity strip.
  const [activityOpen, setActivityOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Objectives (changes) the human has already denied, and proposal ids we have
  // auto-resolved so we don't dispatch the same denial twice.
  const deniedKeysRef = useRef<Set<string>>(new Set());
  const autoDeniedIdsRef = useRef<Set<string>>(new Set());

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
    for (const m of messages) {
      for (const part of m.parts) {
        const p = part as AnyPart;
        if (!p.type?.startsWith("tool-propose")) continue;
        if (p.state !== "input-available" || !p.toolCallId) continue;
        if (autoDeniedIdsRef.current.has(p.toolCallId)) continue;
        const toolName = toolNameOf(p);
        if (!isDeniedObjective(toolName, p.input)) continue;
        autoDeniedIdsRef.current.add(p.toolCallId);
        addToolOutput({
          tool: toolName,
          toolCallId: p.toolCallId,
          output: { approved: false },
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, addToolOutput]);

  const resolveApproval = (part: AnyPart, approved: boolean) => {
    if (!part.toolCallId) return;
    addToolOutput({
      tool: toolNameOf(part),
      toolCallId: part.toolCallId,
      output: { approved },
    });
  };

  const submitInput = () => {
    if (!input.trim()) return;
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
      if (status !== "streaming") submitInput();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  // While a turn is streaming, show a spinner for the model itself unless a
  // tool line is already showing its own in-progress spinner.
  const lastParts = (messages[messages.length - 1]?.parts ?? []) as AnyPart[];
  const lastWorkingTool = lastParts.some((p) => isToolUIPart(p as never) && isRunning(p));
  const showThinking = status === "streaming" && !lastWorkingTool;

  // Only offer the global toggle once there is something to collapse.
  const hasActivity = messages.some((m) =>
    (m.parts as AnyPart[]).some(
      (p) => p.type?.startsWith("tool-") && !p.type.startsWith("tool-propose"),
    ),
  );

  return (
    <div className="chat">
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
            onResolve={resolveApproval}
          />
        ))}
        {showThinking && (
          <div className="msg assistant">
            <span className="avatar" aria-hidden="true">
              🤖
            </span>
            <div className="bubble">
              <p className="tool working">
                <span className="spinner" aria-hidden="true" /> thinking…
              </p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span>⚠ {error.message || "The request failed."}</span>
          <button type="button" onClick={() => clearError()}>
            ✕
          </button>
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
        <button type="submit" disabled={status === "streaming"}>
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
