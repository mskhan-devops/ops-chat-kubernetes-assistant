// ── Chat UI ──
//
// Plain AI SDK chat, no Trigger.dev. The browser holds the conversation and
// sends it to /api/chat; the HITL approval card resolves the no-execute
// proposeDeletion / proposeMemoryIncrease tool calls via addToolOutput, which
// re-sends the message so the agent continues (and only then runs the mutation).

"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";

function MarkdownText({ children }: { children: string }) {
  return (
    <div className="markdown">
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}

export function Chat() {
  const { messages, sendMessage, addToolOutput, stop, status, setMessages, error, clearError } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // once the human answers a propose tool call, re-send so the agent picks up
    // the decision and continues the turn
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (error) => console.error("[ops-chat] useChat error:", error),
  });
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
  const lastParts = messages[messages.length - 1]?.parts ?? [];
  const lastWorkingTool = lastParts.some(
    (p) =>
      isToolUIPart(p) &&
      (p.state === "input-streaming" || p.state === "input-available"),
  );
  const showThinking = status === "streaming" && !lastWorkingTool;

  return (
    <div className="chat">
      <div className="messages">
        {messages.map((m, mi) => (
          <div key={`${m.id}-${mi}`} className={`msg ${m.role}`}>
            <span className="role">{m.role === "user" ? "🧑" : "🤖"}</span>
            <div className="parts">
              {m.parts.map((part, i) => {
                if (part.type === "text")
                  return <MarkdownText key={i}>{part.text}</MarkdownText>;

                // HITL approval card. The agent called a no-execute propose tool
                // and is paused waiting for us.
                if (part.type.startsWith("tool-propose") && isToolUIPart(part)) {
                  const toolName = getToolName(part) as any;
                  const toolInput = part.input as any;
                  // The model streams the tool input token-by-token. Until it is
                  // fully available (state "input-available") the summary would be
                  // partial, so keep the card inert — no leaking half-written text,
                  // no approving incomplete arguments.
                  if (part.state === "input-streaming") {
                    return (
                      <div key={i} className="approval pending" aria-busy="true">
                        <strong>⏳ Approval needed</strong>
                        <div style={{ marginTop: 4, opacity: 0.6 }}>
                          <span className="spinner" aria-hidden="true" /> Preparing details, please wait...
                        </div>
                        <div>
                          <button disabled>✅ Approve</button>
                          <button disabled>❌ Deny</button>
                        </div>
                      </div>
                    );
                  }
                  if (part.state === "input-available") {
                    const renderSummary = () => {
                      if (toolName === "proposeDeletion") return <>delete pod <code>{toolInput?.pod}</code> in <code>{toolInput?.namespace}</code></>;
                      if (toolName === "proposeMemoryIncrease") return <>raise memory of <code>{toolInput?.workload}</code> ({toolInput?.kind}) in <code>{toolInput?.namespace}</code> to <code>{toolInput?.memory}</code></>;
                      if (toolName === "proposeScale") return <>scale <code>{toolInput?.workload}</code> ({toolInput?.kind}) in <code>{toolInput?.namespace}</code> to <code>{toolInput?.replicas}</code> replicas</>;
                      if (toolName === "proposeRolloutRestart") return <>restart rollout <code>{toolInput?.workload}</code> ({toolInput?.kind}) in <code>{toolInput?.namespace}</code></>;
                      if (toolName === "proposeApply") return <>apply manifest in <code>{toolInput?.namespace || "default"}</code></>;
                      if (toolName === "proposeDeleteResource") return <>delete <code>{toolInput?.kind}</code>/<code>{toolInput?.name}</code> {toolInput?.namespace ? <>in <code>{toolInput?.namespace}</code></> : null}</>;
                      return <>approve {toolName}</>;
                    };
                    return (
                      <div key={i} className="approval">
                        <strong>⚠ Approval needed</strong>
                        <div style={{ marginTop: 4 }}>{renderSummary()}</div>
                        {toolInput?.reason && <em> — {toolInput.reason}</em>}
                        <div>
                          <button
                            onClick={() =>
                              addToolOutput({
                                tool: toolName,
                                toolCallId: part.toolCallId,
                                output: { approved: true },
                              })
                            }
                          >
                            ✅ Approve
                          </button>
                          <button
                            onClick={() =>
                              addToolOutput({
                                tool: toolName,
                                toolCallId: part.toolCallId,
                                output: { approved: false },
                              })
                            }
                          >
                            ❌ Deny
                          </button>
                        </div>
                      </div>
                    );
                  }
                  const approved =
                    part.state === "output-available" &&
                    (part.output as { approved?: boolean })?.approved;
                  return (
                    <p key={i} className="tool">
                      {approved ? "✅ approved" : "❌ denied"}
                    </p>
                  );
                }

                // Show tool activity (read-only wire + the executed mutations)
                if (isToolUIPart(part)) {
                  const name = getToolName(part);
                  const isMut = name === "deletePod" || name === "setMemoryLimit";
                  const inProgress =
                    part.state === "input-streaming" || part.state === "input-available";
                  return (
                    <p
                      key={i}
                      className={`tool${isMut ? " mut" : ""}`}
                    >
                      {inProgress ? (
                        <>
                          <span className="spinner" aria-hidden="true" /> {name} · running…
                        </>
                      ) : (
                        <>
                          {part.state === "output-error" ? "❌" : "🔧"} {name} · {part.state}
                          {part.state === "output-error" && (
                            <span> — {(part as { errorText?: string }).errorText}</span>
                          )}
                        </>
                      )}
                    </p>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {showThinking && (
          <div className="msg assistant">
            <span className="role">🤖</span>
            <div className="parts">
              <p className="tool working">
                <span className="spinner" aria-hidden="true" /> thinking…
              </p>
            </div>
          </div>
        )}
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
      <div ref={messagesEndRef} />
    </div>
  );
}
