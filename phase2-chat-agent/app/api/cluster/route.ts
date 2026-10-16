import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const KUBECTL_BIN = process.env.KUBECTL_BIN || "kubectl";

async function kubectl(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec(KUBECTL_BIN, args, { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function GET() {
  const configured = process.env.KUBE_CONTEXT || "";
  const context = configured || (await kubectl(["config", "current-context"])) || "";
  const ctxFlag = context ? ["--context", context] : [];
  const [cluster, ns] = await Promise.all([
    kubectl(["config", "view", "--minify", ...ctxFlag, "-o", "jsonpath={.clusters[0].name}"]),
    kubectl(["config", "view", "--minify", ...ctxFlag, "-o", "jsonpath={.contexts[0].context.namespace}"]),
  ]);

  return NextResponse.json({
    context,
    cluster: cluster || context || "",
    namespace: process.env.KUBE_NAMESPACE || ns || "default",
  });
}
