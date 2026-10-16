// ── Chat UI page ──
import { Chat } from "@/app/components/chat";
import { ClusterBadge } from "@/app/components/cluster-badge";

export default function Home() {
  return (
    <main>
      <h1>🛠 Ops Chat — Kubernetes incident assistant</h1>
      <p>
        Run local or remote: LM Studio, OpenRouter, Groq, or any
        OpenAI-compatible endpoint for inference, kubectl against your kind
        cluster. Ask about the cluster, approve fixes from chat.
      </p>
      <ClusterBadge />
      <Chat kubeBin={process.env.KUBECTL_BIN ?? "kubectl"} kubeContext={process.env.KUBE_CONTEXT ?? ""} />
    </main>
  );
}