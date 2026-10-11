// ── Kubectl arg builder (shared) ──
//
// SINGLE source of truth for the kubectl argv used by every tool. Both the
// server (lib/tools.ts, which actually runs the commands) and the client
// (app/components/chat.tsx, which displays "the command the AI ran" in the
// expanded tool step) import this module, so the shown command can never drift
// from the one that runs.
//
// Pure module: no Node built-ins, no env reads — safe to bundle client-side.

type ToolInput = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function listArgs(resource: string, input: ToolInput, wide: boolean): string[] {
  const all = input.all === true || !input.namespace;
  const args = ["get", resource];
  if (all || !input.namespace) args.push("-A");
  else args.push("-n", str(input.namespace));
  if (wide) args.push("-o", "wide");
  return args;
}

export function kubectlArgs(toolName: string, input: ToolInput): string[] {
  switch (toolName) {
    case "getNamespaces":
      return ["get", "namespaces", "-o", "wide"];
    case "getPods":
      return listArgs("pods", input, true);
    case "getPodLogs": {
      const args = ["logs", str(input.pod), "-n", str(input.namespace), `--tail=${num(input.lines) || 100}`];
      if (input.container) args.push("-c", str(input.container));
      if (input.previous) args.push("-p");
      return args;
    }
    case "describePod":
      return ["describe", "pod", str(input.pod), "-n", str(input.namespace)];
    case "getEvents": {
      const args = ["get", "events", "-o", "wide"];
      if (input.namespace) args.push("-n", str(input.namespace));
      else args.push("-A");
      if (input.since) args.push(`--since=${str(input.since)}`);
      return args;
    }
    case "getServices":
      return listArgs("svc", input, true);
    case "getDeployments":
      return listArgs("deploy", input, true);
    case "getStatefulSets":
      return listArgs("sts", input, true);
    case "getDaemonSets":
      return listArgs("ds", input, true);
    case "getNodes":
      return ["get", "nodes", "-o", "wide"];
    case "getConfigMaps":
      return listArgs("cm", input, false);
    case "getSecrets":
      return listArgs("secrets", input, false);
    case "getIngresses":
      return listArgs("ingress", input, false);
    case "getPvc":
      return listArgs("pvc", input, false);
    case "getPv":
      return ["get", "pv"];
    case "getHpa":
      return listArgs("hpa", input, false);
    case "getTopNodes":
      return ["top", "nodes"];
    case "getTopPods":
      return input.all === true || !input.namespace
        ? ["top", "pods", "-A"]
        : ["top", "pods", "-n", str(input.namespace)];
    case "getMetrics":
      return input.namespace
        ? ["get", "--raw", `/apis/metrics.k8s.io/v1beta1/namespaces/${str(input.namespace)}/pods`]
        : ["get", "--raw", "/apis/metrics.k8s.io/v1beta1/pods"];
    case "execCommand": {
      const args = ["exec", "-n", str(input.namespace), str(input.pod)];
      if (input.container) args.push("-c", str(input.container));
      args.push("--", "sh", "-c", str(input.command));
      return args;
    }
    case "portForward":
      return ["port-forward", "-n", str(input.namespace), str(input.resource), `${num(input.localPort)}:${num(input.remotePort)}`];
    case "deletePod":
      return ["delete", "pod", str(input.pod), "-n", str(input.namespace), "--wait=false"];
    case "setMemoryLimit": {
      // Matches the strategic-merge patch that lib/tools.ts applies for
      // deployment / statefulset / daemonset workloads.
      const kind = str(input.kind) || "statefulset";
      const memory = str(input.memory);
      const patch = `{"spec":{"template":{"spec":{"containers":[{"name":"${str(input.workload)}","resources":{"limits":{"memory":"${memory}"},"requests":{"memory":"${memory}"}}}]}}}}`;
      return ["patch", kind, str(input.workload), "-n", str(input.namespace), "--type=strategic", "-p", patch];
    }
    case "scaleWorkload":
      return ["scale", `${str(input.kind) || "deployment"}/${str(input.workload)}`, `--replicas=${num(input.replicas)}`, "-n", str(input.namespace)];
    case "rolloutRestart":
      return ["rollout", "restart", `${str(input.kind) || "deployment"}/${str(input.workload)}`, "-n", str(input.namespace)];
    case "deleteResource": {
      const args = ["delete", str(input.kind), str(input.name)];
      if (input.namespace) args.push("-n", str(input.namespace));
      return args;
    }
    case "applyManifest": {
      const args = ["apply", "-f", "<manifest>"];
      if (input.namespace) args.push("-n", str(input.namespace));
      return args;
    }
    default:
      return [];
  }
}

// Full command line as it appears (and is executed) on the server, e.g.
// `kubectl --context kind-my-v137-cluster get pods -A -o wide`.
export function formatCommand(
  toolName: string,
  input: ToolInput,
  bin: string,
  kubeContext: string,
): string {
  const args = kubectlArgs(toolName, input);
  if (args.length === 0) return "";
  const prefix = [bin || "kubectl", ...(kubeContext ? ["--context", kubeContext] : [])];
  return prefix.concat(args).join(" ");
}