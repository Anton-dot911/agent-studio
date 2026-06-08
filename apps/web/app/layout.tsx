// apps/web/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Studio",
  description: "AI-powered Web3 document generation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uk">
      <body className="bg-[#07090f] text-[#9aa8c0] antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
