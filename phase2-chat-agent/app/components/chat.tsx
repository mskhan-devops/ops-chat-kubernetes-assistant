// ── Chat UI ──
//
// Plain AI SDK chat, no Trigger.dev. The browser holds the conversation and
// sends it to /api/chat; the HITL approval card resolves the no-execute
// proposeDeletion / proposeMemoryIncrease tool calls via addToolOutput, which
// re-sends the message so the agent continues (and only then runs the mutation).

"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";

export function Chat() {
  const { messages, sendMessage, addToolOutput, stop, status, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // once the human answers a propose tool call, re-send so the agent picks up
    // the decision and continues the turn
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (error) => console.error("[ops-chat] useChat error:", error),
  });
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="chat">
      <div className="messages">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <span className="role">{m.role === "user" ? "🧑" : "🤖"}</span>
            <div className="parts">
              {m.parts.map((part, i) => {
                if (part.type === "text") return <p key={i}>{part.text}</p>;

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
                        <div style={{ marginTop: 4, opacity: 0.6 }}>Preparing details, please wait...</div>
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
                  return (
                    <p
                      key={i}
                      className={
                        name === "deletePod" || name === "setMemoryLimit"
                          ? "tool mut"
                          : "tool"
                      }
                    >
                      🔧 {name} · {part.state}
                      {part.state === "output-error" && (
                        <span> — {(part as { errorText?: string }).errorText}</span>
                      )}
                    </p>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) {
            sendMessage({ text: input });
            setInput("");
          }
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Try: "why is payments crashing?"'
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
