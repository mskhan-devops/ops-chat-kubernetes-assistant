import { tool } from "ai";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ApprovalChecker } from "./approvals";
import { kubectlArgs } from "./kubectl-args";

const exec = promisify(execFile);

const useRealCluster = process.env.USE_REAL_CLUSTER !== "false";
const KUBECTL_BIN = process.env.KUBECTL_BIN || "kubectl";
const KUBE_CONTEXT = process.env.KUBE_CONTEXT || "";

function kubectl(args: string[]): Promise<string> {
  const full = KUBE_CONTEXT ? ["--context", KUBE_CONTEXT, ...args] : args;
  return exec(KUBECTL_BIN, full, { timeout: 300_000 }).then(
    (r) => r.stdout,
    (err: { stderr?: string | Buffer; stdout?: string | Buffer; message?: string }) => {
      const detail = String(err?.stderr || err?.stdout || err?.message || err)
        .toString()
        .trim();
      throw new Error(`kubectl ${full.join(" ")} failed: ${detail || "unknown error"}`);
    },
  );
}

// Mock data for demo mode
const MOCK_PODS = `NAME                        READY   STATUS             RESTARTS   AGE
payments-7d4b9c6f5-x2m4p    1/1     Running            0          2d
payments-7d4b9c6f5-q8k2n    0/1     CrashLoopBackOff   14         37m
orders-6c8d7b5e4-h3j9w      1/1     Running            0          2d
orders-6c8d7b5e4-t5r7y      1/1     Running            0          2d
redis-0                     1/1     Running            0          2d`;

const MOCK_LOGS = `2026-09-07T10:41:02Z ERROR payments: ECONNREFUSED redis:6379 (retry 12/15)
2026-09-07T10:41:07Z ERROR payments: heap out of memory — allocation failed
2026-09-07T10:41:08Z FATAL payments: worker exited with code 137`;

const MOCK_NAMESPACES = `NAME              STATUS   AGE
default           Active   1d
kube-system       Active   1d
kube-public       Active   1d
demo              Active   1h`;

const nsSchema = z.object({ namespace: z.string().optional().describe("Namespace name. Omit to use current/default context behavior.") });

export function createClusterTools(requireApproval: ApprovalChecker) {
  return {
  // Read-only tools
  getNamespaces: tool({
    description: "List all namespaces in the cluster.",
    inputSchema: z.object({}),
    execute: async () => (useRealCluster ? kubectl(["get", "namespaces", "-o", "wide"]) : MOCK_NAMESPACES),
  }),

  getPods: tool({
    description: "List pods in a namespace. If namespace omitted, lists across all namespaces (-A).",
    inputSchema: nsSchema.extend({ all: z.boolean().optional().default(false) }),
    execute: async ({ namespace, all }) => {
      if (!useRealCluster) return MOCK_PODS;
      return kubectl(kubectlArgs("getPods", { namespace, all }));
    },
  }),

  getPodLogs: tool({
    description: "Fetch recent logs for a pod.",
    inputSchema: z.object({
      pod: z.string(),
      namespace: z.string(),
      container: z.string().optional(),
      lines: z.number().default(100),
      previous: z.boolean().optional().default(false),
    }),
    execute: async ({ pod, namespace, container, lines, previous }) => {
      if (!useRealCluster) return MOCK_LOGS;
      return kubectl(kubectlArgs("getPodLogs", { pod, namespace, container, lines, previous }));
    },
  }),

  describePod: tool({
    description: "Describe a pod with detailed events and status.",
    inputSchema: z.object({ pod: z.string(), namespace: z.string() }),
    execute: async ({ pod, namespace }) =>
      useRealCluster ? kubectl(kubectlArgs("describePod", { pod, namespace })) : "describe: mock",
  }),

  getEvents: tool({
    description: "Get cluster events, optionally filtered by namespace.",
    inputSchema: nsSchema.extend({ since: z.string().optional() }),
    execute: async ({ namespace, since }) => {
      if (!useRealCluster) return "mock events";
      return kubectl(kubectlArgs("getEvents", { namespace, since }));
    },
  }),

  getServices: tool({
    description: "List services.",
    inputSchema: nsSchema.extend({ all: z.boolean().optional() }),
    execute: async ({ namespace, all }) => {
      if (!useRealCluster) return "services: mock";
      return kubectl(kubectlArgs("getServices", { namespace, all }));
    },
  }),

  getDeployments: tool({
    description: "List deployments.",
    inputSchema: nsSchema.extend({ all: z.boolean().optional() }),
    execute: async ({ namespace, all }) => {
      if (!useRealCluster) return "deployments: mock";
      return kubectl(kubectlArgs("getDeployments", { namespace, all }));
    },
  }),

  getStatefulSets: tool({
    description: "List statefulsets.",
    inputSchema: nsSchema.extend({ all: z.boolean().optional() }),
    execute: async ({ namespace, all }) => {
      if (!useRealCluster) return "sts: mock";
      return kubectl(kubectlArgs("getStatefulSets", { namespace, all }));
    },
  }),

  getDaemonSets: tool({
    description: "List daemonsets.",
    inputSchema: nsSchema.extend({ all: z.boolean().optional() }),
    execute: async ({ namespace, all }) => {
      if (!useRealCluster) return "ds: mock";
      return kubectl(kubectlArgs("getDaemonSets", { namespace, all }));
    },
  }),

  getNodes: tool({
    description: "List nodes.",
    inputSchema: z.object({}),
    execute: async () => (useRealCluster ? kubectl(kubectlArgs("getNodes", {})) : "nodes: mock"),
  }),

  getConfigMaps: tool({
    description: "List configmaps.",
    inputSchema: nsSchema.extend({ all: z.boolean().optional() }),
    execute: async ({ namespace, all }) => {
      if (!useRealCluster) return "cm: mock";
      return kubectl(kubectlArgs("getConfigMaps", { namespace, all }));
    },
  }),

  getSecrets: tool({
    description: "List secrets (metadata only).",
    inputSchema: nsSchema.extend({ all: z.boolean().optional() }),
    execute: async ({ namespace, all }) => {
      if (!useRealCluster) return "secrets: mock";
      return kubectl(kubectlArgs("getSecrets", { namespace, all }));
    },
  }),

  getIngresses: tool({
    description: "List ingresses.",
    inputSchema: nsSchema.extend({ all: z.boolean().optional() }),
    execute: async ({ namespace, all }) => {
      if (!useRealCluster) return "ingress: mock";
      return kubectl(kubectlArgs("getIngresses", { namespace, all }));
    },
  }),

  getPvc: tool({
    description: "List PVCs.",
    inputSchema: nsSchema.extend({ all: z.boolean().optional() }),
    execute: async ({ namespace, all }) => {
      if (!useRealCluster) return "pvc: mock";
      return kubectl(kubectlArgs("getPvc", { namespace, all }));
    },
  }),

  getPv: tool({
    description: "List PVs.",
    inputSchema: z.object({}),
    execute: async () => (useRealCluster ? kubectl(kubectlArgs("getPv", {})) : "pv: mock"),
  }),

  getHpa: tool({
    description: "List HPAs.",
    inputSchema: nsSchema.extend({ all: z.boolean().optional() }),
    execute: async ({ namespace, all }) => {
      if (!useRealCluster) return "hpa: mock";
      return kubectl(kubectlArgs("getHpa", { namespace, all }));
    },
  }),

  getTopNodes: tool({
    description: "Get node resource usage.",
    inputSchema: z.object({}),
    execute: async () => (useRealCluster ? kubectl(kubectlArgs("getTopNodes", {})) : "top nodes: mock"),
  }),

  getTopPods: tool({
    description: "Get pod resource usage.",
    inputSchema: nsSchema.extend({ all: z.boolean().optional() }),
    execute: async ({ namespace, all }) => {
      if (!useRealCluster) return "top pods: mock";
      return kubectl(kubectlArgs("getTopPods", { namespace, all }));
    },
  }),

  getMetrics: tool({
    description: "Show raw metrics (metrics-server).",
    inputSchema: nsSchema,
    execute: async ({ namespace }) => {
      if (!useRealCluster) return "metrics: mock";
      return kubectl(kubectlArgs("getMetrics", { namespace }));
    },
  }),

  // Proposals (HITL) - mutations
  proposeDeletion: tool({
    description: "Propose deleting a pod. Must be approved before deletePod.",
    inputSchema: z.object({
      pod: z.string(),
      namespace: z.string(),
      reason: z.string().describe("One-line reason"),
    }),
  }),

  proposeMemoryIncrease: tool({
    description: "Propose increasing memory for a workload (StatefulSet/Deployment).",
    inputSchema: z.object({
      workload: z.string(),
      kind: z.enum(["deployment", "statefulset", "daemonset", "job", "cronjob"]).default("statefulset"),
      namespace: z.string(),
      memory: z.string().describe("e.g. 256Mi, 512Mi"),
      reason: z.string().describe("One-line reason"),
    }),
  }),

  proposeScale: tool({
    description: "Propose scaling a workload.",
    inputSchema: z.object({
      workload: z.string(),
      kind: z.enum(["deployment", "statefulset", "daemonset"]).default("deployment"),
      namespace: z.string(),
      replicas: z.number().int().positive(),
      reason: z.string(),
    }),
  }),

  proposeRolloutRestart: tool({
    description: "Propose restarting a rollout.",
    inputSchema: z.object({
      workload: z.string(),
      kind: z.enum(["deployment", "statefulset", "daemonset"]).default("deployment"),
      namespace: z.string(),
      reason: z.string(),
    }),
  }),

  proposeApply: tool({
    description: "Propose applying a manifest (YAML).",
    inputSchema: z.object({
      manifest: z.string().describe("Full YAML manifest"),
      namespace: z.string().optional(),
      reason: z.string(),
    }),
  }),

  proposeDeleteResource: tool({
    description: "Propose deleting any resource.",
    inputSchema: z.object({
      kind: z.string().describe("e.g. pod, deployment, svc, cm, secret"),
      name: z.string(),
      namespace: z.string().optional(),
      reason: z.string(),
    }),
  }),

  // Mutations
  deletePod: tool({
    description: "Delete a pod (requires approved proposeDeletion).",
    inputSchema: z.object({ pod: z.string(), namespace: z.string() }),
    execute: async ({ pod, namespace }) => {
      requireApproval("deletePod", { pod, namespace });
      if (!useRealCluster) return `pod ${pod} deleted (mock)`;
      return kubectl(kubectlArgs("deletePod", { pod, namespace }));
    },
  }),

  setMemoryLimit: tool({
    description: "Patch memory limit and rollout (requires approved proposeMemoryIncrease).",
    inputSchema: z.object({
      workload: z.string(),
      kind: z.enum(["deployment", "statefulset", "daemonset", "job", "cronjob"]).default("statefulset"),
      namespace: z.string(),
      memory: z.string(),
    }),
    execute: async ({ workload, kind, namespace, memory }) => {
      requireApproval("setMemoryLimit", { workload, kind, namespace, memory });
      if (!useRealCluster) return `${workload} memory set to ${memory} (mock)`;
      if (kind === "deployment" || kind === "statefulset" || kind === "daemonset") {
        const patched = await kubectl(kubectlArgs("setMemoryLimit", { workload, kind, namespace, memory }));
        try {
          const rolled = await kubectl(["rollout", "status", `${kind}/${workload}`, "-n", namespace, "--timeout=180s"]);
          return `${patched.trim()}\n${rolled.trim()}`;
        } catch (e) {
          return patched.trim();
        }
      }
      return kubectl(["patch", kind, workload, "-n", namespace, "--type=strategic", "-p", JSON.stringify({ spec: { template: { spec: { containers: [{ resources: { limits: { memory }, requests: { memory } } }] } } } })]);
    },
  }),

  scaleWorkload: tool({
    description: "Scale workload (requires approved proposeScale).",
    inputSchema: z.object({
      workload: z.string(),
      kind: z.enum(["deployment", "statefulset", "daemonset"]).default("deployment"),
      namespace: z.string(),
      replicas: z.number().int().positive(),
    }),
    execute: async ({ workload, kind, namespace, replicas }) => {
      requireApproval("scaleWorkload", { workload, kind, namespace, replicas });
      if (!useRealCluster) return `scaled ${workload} to ${replicas} (mock)`;
      return kubectl(kubectlArgs("scaleWorkload", { workload, kind, namespace, replicas }));
    },
  }),

  rolloutRestart: tool({
    description: "Restart rollout (requires approved proposeRolloutRestart).",
    inputSchema: z.object({
      workload: z.string(),
      kind: z.enum(["deployment", "statefulset", "daemonset"]).default("deployment"),
      namespace: z.string(),
      reason: z.string().optional(),
    }),
    execute: async ({ workload, kind, namespace }) => {
      requireApproval("rolloutRestart", { workload, kind, namespace });
      if (!useRealCluster) return `restarted ${workload} (mock)`;
      return kubectl(kubectlArgs("rolloutRestart", { workload, kind, namespace }));
    },
  }),

  applyManifest: tool({
    description: "Apply manifest from string (requires approved proposeApply).",
    inputSchema: z.object({ manifest: z.string(), namespace: z.string().optional() }),
    execute: async ({ manifest, namespace }) => {
      requireApproval("applyManifest", { manifest, namespace });
      if (!useRealCluster) return "applied (mock)";
      const tmp = `/tmp/opencode-manifest-${Date.now()}.yaml`;
      const fs = await import("fs/promises");
      await fs.writeFile(tmp, manifest);
      const args = ["apply", "-f", tmp];
      if (namespace) args.push("-n", namespace);
      return kubectl(args);
    },
  }),

  deleteResource: tool({
    description: "Delete resource (requires approved proposeDeleteResource).",
    inputSchema: z.object({
      kind: z.string(),
      name: z.string(),
      namespace: z.string().optional(),
    }),
    execute: async ({ kind, name, namespace }) => {
      requireApproval("deleteResource", { kind, name, namespace });
      if (!useRealCluster) return `deleted ${kind}/${name} (mock)`;
      return kubectl(kubectlArgs("deleteResource", { kind, name, namespace }));
    },
  }),

  execCommand: tool({
    description: "Execute command in a pod (non-interactive).",
    inputSchema: z.object({
      pod: z.string(),
      namespace: z.string(),
      container: z.string().optional(),
      command: z.string().describe("Shell command, e.g. 'ls /app' or 'curl -s http://localhost:8080/health'"),
    }),
    execute: async ({ pod, namespace, container, command }) => {
      if (!useRealCluster) return "exec: mock";
      return kubectl(kubectlArgs("execCommand", { pod, namespace, container, command }));
    },
  }),

  portForward: tool({
    description: "Port-forward to a pod/service (non-blocking best effort; returns confirmation).",
    inputSchema: z.object({
      resource: z.string().describe("pod/podname or svc/servicename"),
      namespace: z.string(),
      localPort: z.number().int(),
      remotePort: z.number().int(),
    }),
    execute: async ({ resource, namespace, localPort, remotePort }) => {
      if (!useRealCluster) return `port-forwarding ${resource}:${remotePort} -> localhost:${localPort} (mock)`;
      // Best effort; fire and forget in practice for this context
      const args = KUBE_CONTEXT
        ? ["--context", KUBE_CONTEXT, ...kubectlArgs("portForward", { resource, namespace, localPort, remotePort })]
        : kubectlArgs("portForward", { resource, namespace, localPort, remotePort });
      exec(KUBECTL_BIN, args, { timeout: 1000 }).catch(() => {});
      return `Initiated port-forward ${resource}:${remotePort} -> localhost:${localPort}`;
    },
  }),
  };
}

export const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS ?? 30);
