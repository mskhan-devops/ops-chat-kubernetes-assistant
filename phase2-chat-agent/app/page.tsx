// ── Chat UI page ──
import { Chat } from "@/app/components/chat";

export default function Home() {
  return (
    <main>
      <h1>🛠 Ops Chat — local Kubernetes incident assistant</h1>
      <p>
        Runs fully locally: LM Studio for inference, kubectl against your kind
        cluster. Ask about the cluster, approve fixes from chat.
      </p>
      <Chat />
    </main>
  );
}
