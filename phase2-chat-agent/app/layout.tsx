import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Ops Chat · Kubernetes assistant",
  description: "AI chat agent for a kind cluster, powered by local or remote OpenAI-compatible LLMs",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
