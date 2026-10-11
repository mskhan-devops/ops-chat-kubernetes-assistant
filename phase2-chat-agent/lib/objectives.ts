// ── Objective keys ──
//
// A human denial is scoped to the *change* being proposed, not to the specific
// propose tool the model happened to pick. The model sometimes re-targets the
// same change through another tool (e.g. proposeMemoryIncrease is denied, then
// it tries to reach the same memory bump via proposeApply), which would re-prompt
// for approval. These helpers map a proposal (or a mutation) to stable objective
// keys so both the client (chat.tsx) and the server (approvals.ts) can tell that
// a new proposal is really the same, already-decided change.

export function norm(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim().toLowerCase();
}

// Cheap YAML lite-parser: pull out the top-level kind / name / namespace and
// whether the manifest touches resource limits (the only signal we need for
// cross-tool memory-raise detection).
function parseManifest(manifest: string): {
  kind?: string;
  name?: string;
  namespace?: string;
  setsMemory?: boolean;
} {
  const out: { kind?: string; name?: string; namespace?: string; setsMemory?: boolean } = {};
  let inSpec = false;
  for (const raw of manifest.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^spec\s*:/.test(line)) inSpec = true;
    const m = line.match(/^(kind|name|namespace)\s*:\s*["']?([^"',#]+)["']?\s*$/);
    if (m && !inSpec) {
      const value = m[2].trim();
      if (!value) continue;
      if (m[1] === "kind") out.kind = value;
      if (m[1] === "name") out.name = value;
      if (m[1] === "namespace") out.namespace = value;
    }
    if (/^limits\s*:/.test(line)) out.setsMemory = true;
    if (/^memory\s*:/.test(line)) out.setsMemory = true;
  }
  return out;
}

// toolName is the propose/mutation name in camelCase (e.g. "proposeMemoryIncrease").
export function objectiveKeys(toolName: string, input: Record<string, unknown>): string[] {
  const ns = norm(input.namespace);

  switch (toolName) {
    case "proposeDeletion": {
      const pod = norm(input.pod);
      return pod ? [`delete-pod:${ns}:${pod}`] : [];
    }
    case "proposeMemoryIncrease": {
      const workload = norm(input.workload);
      return workload ? [`memory:${ns}:${workload}`] : [];
    }
    case "proposeScale": {
      const workload = norm(input.workload);
      return workload ? [`scale:${ns}:${workload}`] : [];
    }
    case "proposeRolloutRestart": {
      const workload = norm(input.workload);
      return workload ? [`restart:${ns}:${workload}`] : [];
    }
    case "proposeDeleteResource": {
      const kind = norm(input.kind);
      const name = norm(input.name);
      return kind && name ? [`delete-resource:${ns}:${kind}:${name}`] : [];
    }
    case "proposeApply":
    case "applyManifest": {
      const manifest = norm(input.manifest);
      if (!manifest) return [];
      const { kind, name, namespace, setsMemory } = parseManifest(manifest);
      if (!name) return [];
      const manifestNs = norm(namespace ?? "") || ns;
      const keys = [`apply:${norm(kind)}:${manifestNs}:${name}`];
      if (setsMemory) keys.push(`memory:${manifestNs}:${name}`);
      return keys;
    }
    case "deletePod": {
      const pod = norm(input.pod);
      return pod ? [`delete-pod:${ns}:${pod}`] : [];
    }
    case "setMemoryLimit": {
      const workload = norm(input.workload);
      return workload ? [`memory:${ns}:${workload}`] : [];
    }
    case "scaleWorkload": {
      const workload = norm(input.workload);
      return workload ? [`scale:${ns}:${workload}`] : [];
    }
    case "rolloutRestart": {
      const workload = norm(input.workload);
      return workload ? [`restart:${ns}:${workload}`] : [];
    }
    case "deleteResource": {
      const kind = norm(input.kind);
      const name = norm(input.name);
      return kind && name ? [`delete-resource:${ns}:${kind}:${name}`] : [];
    }
    default:
      return [];
  }
}