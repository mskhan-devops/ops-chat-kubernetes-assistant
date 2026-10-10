// ── Chat UI ──
//
// Plain AI SDK chat, no Trigger.dev. The browser holds the conversation and
// sends it to /api/chat; the HITL approval card resolves the no-execute
// proposeDeletion / proposeMemoryIncrease tool calls via addToolOutput, which
// re-sends the message so the agent continues (and only then runs the mutation).

"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";

export function Chat() {
  const { messages, sendMessage, addToolOutput, stop, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // once the human answers a propose tool call, re-send so the agent picks up
    // the decision and continues the turn
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (error) => console.error("[ops-chat] useChat error:", error),
  });
  const [input, setInput] = useState("");

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
                if (
                  part.type === "tool-proposeDeletion" ||
                  part.type === "tool-proposeMemoryIncrease"
                ) {
                  const toolName = part.type.replace("tool-", "") as
                    | "proposeDeletion"
                    | "proposeMemoryIncrease";
                  const toolInput = part.input as {
                    pod?: string;
                    workload?: string;
                    memory?: string;
                    reason?: string;
                  };
                  if (part.state === "input-available") {
                    return (
                      <div key={i} className="approval">
                        <strong>⚠ Approval needed:</strong>{" "}
                        {toolName === "proposeDeletion" ? (
                          <>
                            delete pod <code>{toolInput.pod}</code>
                          </>
                        ) : (
                          <>
                            raise memory limit of <code>{toolInput.workload}</code> to{" "}
                            <code>{toolInput.memory}</code>
                          </>
                        )}
                        <em> — {toolInput.reason}</em>
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
                  // once answered, show the decision instead of the buttons
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
      </form>
    </div>
  );
}
