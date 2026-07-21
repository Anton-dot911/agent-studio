import type { Metadata } from "next";
import "./globals.css";
import "@coinbase/onchainkit/styles.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Agent Studio",
  description: "AI-powered Web3 document generation",
  other: {
    "base:app_id": ["6a372b925b44c07f071b0ab5", "6a5c0a418ed069984d57c5da"],
    "talentapp:project_verification":
      "53533d63ed296ee75a9f1d41aa4962784151e3b1a8866ca5549e19d6079bdad6f8e393efaaccb22d757e00165a1ce8ad61c2db9a36bc4c537b3a8ac32aa64dd9",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body className="antialiased min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
