import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Ops Chat · local Kubernetes assistant",
  description: "Local AI chat agent for a kind cluster, powered by LM Studio",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
