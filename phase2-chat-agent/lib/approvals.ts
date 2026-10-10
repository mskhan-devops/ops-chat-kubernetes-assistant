// ── Server-side HITL enforcement ──
//
// The system prompt tells the model to wait for approval, but a prompt is not a
// security boundary: the mutating tools still had unconditional `execute`
// functions, so a model that ignored a denial could delete anyway.
//
// This module rebuilds the human's decisions from the UI message history (the
// propose* tool calls resolved via addToolOutput) and hands the tools a checker
// that throws unless there is an *approved, not-yet-consumed* proposal for the
// same target. A denial for a target always wins over any older approval.

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

// Identity fields used to bind a mutation to the proposal it came from. We
// deliberately do NOT compare free-form payloads (e.g. a full YAML manifest):
// the model re-emits them when it calls the mutation and they never match
// byte-for-byte. An empty list means "bind to the latest proposal of this type".
const MATCH_KEYS: Record<string, string[]> = {
  deletePod: ["pod", "namespace"],
  setMemoryLimit: ["workload", "kind", "namespace", "memory"],
  scaleWorkload: ["workload", "kind", "namespace", "replicas"],
  rolloutRestart: ["workload", "kind", "namespace"],
  applyManifest: [],
  deleteResource: ["kind", "name", "namespace"],
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

// A missing value on either side is treated as a wildcard so that omitted/`null`
// fields (e.g. namespace defaulting) never cause a false rejection.
function targetsMatch(mutation: string, proposalInput: Record<string, unknown>, args: Record<string, unknown>): boolean {
  const keys = MATCH_KEYS[mutation] ?? [];
  return keys.every((key) => {
    const proposed = proposalInput[key];
    const actual = args[key];
    if (proposed === undefined || proposed === null) return true;
    if (actual === undefined || actual === null) return true;
    return normalize(proposed) === normalize(actual);
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

  const findLatest = (mutation: string, args: Record<string, unknown>) => {
    const proposalName = PROPOSAL_FOR[mutation];
    for (let i = proposals.length - 1; i >= 0; i--) {
      const proposal = proposals[i];
      if (proposal.toolName !== proposalName) continue;
      if (!targetsMatch(mutation, proposal.input, args)) continue;
      return proposal;
    }
    return undefined;
  };

  // A mutation already present in the history (output-available) means its
  // matching approval was spent — so it can't be silently reused on a later
  // turn without a fresh proposal.
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const p = part as { type?: string; state?: string; input?: unknown };
      if (!p.type?.startsWith("tool-")) continue;
      const mutation = p.type.slice("tool-".length);
      if (!PROPOSAL_FOR[mutation] || p.state !== "output-available") continue;
      const spent = findLatest(mutation, (p.input ?? {}) as Record<string, unknown>);
      if (spent) spent.consumed = true;
    }
  }

  return function requireApproval(mutation, args) {
    const proposalName = PROPOSAL_FOR[mutation];
    if (!proposalName) {
      throw new Error(`Action blocked: ${mutation} is not an approved mutation.`);
    }

    const proposal = findLatest(mutation, args);
    if (!proposal) {
      throw new Error(
        `Action blocked: ${mutation} requires an approved ${proposalName} first. Ask the user to approve a proposal before running it.`,
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
