// ── Server-side HITL enforcement ──
//
// The system prompt tells the model to wait for approval, but a prompt is not a
// security boundary: the mutating tools still had unconditional `execute`
// functions, so a model that ignored a denial could delete anyway.
//
// This module rebuilds the human's decisions from the UI message history (the
// propose* tool calls resolved via addToolOutput) and hands the tools a checker
// that throws unless there is an *approved, not-yet-consumed* proposal for the
// exact same target. A denial for a target always wins over any older approval.

import type { UIMessage } from "ai";

// mutation tool -> the propose tool that must gate it
const PROPOSAL_FOR: Record<string, string> = {
  deletePod: "proposeDeletion",
  setMemoryLimit: "proposeMemoryIncrease",
  scaleWorkload: "proposeScale",
  rolloutRestart: "proposeRolloutRestart",
  applyManifest: "proposeApply",
  deleteResource: "proposeDeleteResource",
};

type Proposal = {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  approved: boolean;
  consumed: boolean;
};

function normalize(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return JSON.stringify(value ?? null);
}

// every argument of the mutation must match the proposal input (reason excluded
// because only the proposal carries it)
function targetsMatch(
  proposalInput: Record<string, unknown>,
  args: Record<string, unknown>,
): boolean {
  return Object.entries(args).every(([key, value]) => {
    if (value === undefined) return true;
    return normalize(proposalInput[key]) === normalize(value);
  });
}

export type ApprovalChecker = (mutation: string, args: Record<string, unknown>) => void;

export function createApprovalChecker(messages: UIMessage[]): ApprovalChecker {
  const proposals: Proposal[] = [];

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const p = part as {
        type?: string;
        state?: string;
        toolCallId?: string;
        input?: unknown;
        output?: unknown;
      };
      if (!p.type?.startsWith("tool-propose")) continue;
      if (p.state !== "output-available") continue;
      proposals.push({
        id: p.toolCallId ?? "",
        toolName: p.type.slice("tool-".length),
        input: (p.input ?? {}) as Record<string, unknown>,
        approved: (p.output as { approved?: boolean } | undefined)?.approved === true,
        consumed: false,
      });
    }
  }

  const findLatest = (toolName: string, args: Record<string, unknown>) => {
    for (let i = proposals.length - 1; i >= 0; i--) {
      const proposal = proposals[i];
      if (proposal.toolName !== toolName) continue;
      if (!targetsMatch(proposal.input, args)) continue;
      return proposal;
    }
    return undefined;
  };

  // A mutation already present in the history (output-available) means its
  // matching approval was spent — so it can't be silently reused on a later
  // turn without a fresh proposal.
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const p = part as {
        type?: string;
        state?: string;
        input?: unknown;
      };
      if (!p.type?.startsWith("tool-")) continue;
      const mutation = p.type.slice("tool-".length);
      const proposalName = PROPOSAL_FOR[mutation];
      if (!proposalName || p.state !== "output-available") continue;
      const spent = findLatest(proposalName, (p.input ?? {}) as Record<string, unknown>);
      if (spent) spent.consumed = true;
    }
  }

  return function requireApproval(mutation, args) {
    const proposalName = PROPOSAL_FOR[mutation];
    if (!proposalName) {
      throw new Error(`Action blocked: ${mutation} is not an approved mutation.`);
    }

    const proposal = findLatest(proposalName, args);
    if (!proposal) {
      throw new Error(
        `Action blocked: ${mutation} requires an approved ${proposalName} for this exact target first.`,
      );
    }
    if (proposal.consumed) {
      throw new Error(
        `Action blocked: the approval for this target was already used. Ask the user before acting again.`,
      );
    }
    if (!proposal.approved) {
      throw new Error(
        `Action blocked: the user DENIED the ${proposalName} for this target. Do not retry or work around it; tell the user it was denied.`,
      );
    }

    proposal.consumed = true;
  };
}
