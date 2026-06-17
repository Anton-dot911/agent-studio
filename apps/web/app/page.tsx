"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function DashboardPage() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark") {
      setDark(true);
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const card = {
    background: "var(--card)",
    borderRadius: 20,
    boxShadow: "var(--shadow)",
    border: "1.5px solid rgba(15,18,64,0.06)",
  } as React.CSSProperties;

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "28px 18px 60px" }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 26 }}>
        <div>
          <p style={{ fontSize: 11, letterSpacing: "4px", textTransform: "uppercase", color: "var(--dim)", marginBottom: 10, fontWeight: 600 }}>
            Agent Studio v0.1
          </p>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: "var(--bright)", lineHeight: 1.15, letterSpacing: "-0.5px" }}>
            Web3 Document<br />Agent
          </h1>
        </div>
        <button onClick={toggleTheme} aria-label="Toggle theme" style={{
          width: 44, height: 44, borderRadius: 50, flexShrink: 0,
          background: "var(--card)", boxShadow: "var(--shadow-sm)",
          border: "1.5px solid rgba(15,18,64,0.10)", cursor: "pointer", fontSize: 16, fontWeight: 700,
          color: "var(--text)",
        }}>
          {dark ? "L" : "D"}
        </button>
      </div>

      <p style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.7, marginBottom: 26 }}>
        AI agents generate technical documents for Web3 projects.
        Tech Spec, Tokenomics, DeFi Audit.
      </p>

      <Link href="/run" style={{ ...card, display: "block", padding: "22px", marginBottom: 22, textDecoration: "none" }}>
        <p style={{ fontSize: 11, letterSpacing: "3px", textTransform: "uppercase", color: "var(--accent)", marginBottom: 10, fontWeight: 700 }}>
          New project
        </p>
        <p style={{ fontSize: 21, fontWeight: 700, color: "var(--bright)", marginBottom: 8 }}>
          Run Research Agent
        </p>
        <p style={{ fontSize: 14, color: "var(--dim)", lineHeight: 1.6 }}>
          Fill the intake form. The agent analyzes your project and returns a JSON report in about 45 seconds.
        </p>
      </Link>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 22 }}>
        {[
          { label: "Projects", value: "0", color: "var(--cyan)" },
          { label: "Documents", value: "0", color: "var(--green)" },
          { label: "Spent", value: "$0", color: "var(--purple)" },
        ].map((s) => (
          <div key={s.label} style={{ ...card, padding: "18px 14px" }}>
            <p style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "var(--dim)", marginBottom: 10, fontWeight: 600 }}>
              {s.label}
            </p>
            <p style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div style={{ ...card, padding: "22px 20px" }}>
        <p style={{ fontSize: 11, letterSpacing: "3px", textTransform: "uppercase", color: "var(--dim)", marginBottom: 20, fontWeight: 600 }}>
          Pipeline (Phase 2)
        </p>
        {[
          { n: "01", name: "Research Agent", active: true, phase: "ACTIVE", time: "45s", desc: "Analyzes project, competitors, market" },
          { n: "02", name: "Writer Agent", active: true, phase: "ACTIVE", time: "60s", desc: "Generates the full technical document" },
          { n: "03", name: "QA Agent", active: true, phase: "ACTIVE", time: "30s", desc: "Checks quality, scores document 1-10" },
          { n: "04", name: "Delivery Agent", active: true, phase: "ACTIVE", time: "10s", desc: "Sends PDF and email to the client" },
        ].map((step, i, arr) => (
          <div key={step.n} style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: i === arr.length - 1 ? 0 : 18 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 800,
              background: step.active ? "var(--accent)" : "var(--card2)",
              color: step.active ? "#ffffff" : "var(--dim)",
              boxShadow: step.active ? "0 4px 12px rgba(33,37,102,0.28)" : "none",
            }}>
              {step.n}
            </div>
            <div style={{ flex: 1, paddingTop: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: step.active ? "var(--bright)" : "var(--dim)" }}>
                  {step.name}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", padding: "3px 10px", borderRadius: 50, background: "rgba(16,185,129,0.10)", color: "var(--green)", border: "1px solid rgba(16,185,129,0.20)" }}>{step.phase}</span>
                <span style={{ fontSize: 11, color: "var(--dim)" }}>{step.time}</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.5 }}>{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
