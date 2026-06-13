"use client";
import { useState } from "react";
import Link from "next/link";

type RunStatus = "idle" | "running" | "done" | "error";

const FIELDS = [
  { key: "projectName", label: "01 - Project Name", hint: "Short name", rows: 0 },
  { key: "concept", label: "02 - Concept", hint: "3-5 sentences what you are building", rows: 3 },
  { key: "problem", label: "03 - Problem", hint: "What problem does it solve?", rows: 2 },
  { key: "targetAudience", label: "04 - Audience", hint: "Who is the user?", rows: 0 },
  { key: "blockchain", label: "05 - Blockchain", hint: "Base, Ethereum, Solana, or N/A", rows: 0 },
  { key: "existingCode", label: "06 - Existing Code", hint: "Link or none", rows: 0 },
  { key: "competitors", label: "07 - Competitors", hint: "Uniswap, Aave...", rows: 0 },
  { key: "teamInfo", label: "08 - Team", hint: "Size and experience", rows: 0 },
  { key: "timeline", label: "09 - Timeline", hint: "MVP in how long?", rows: 0 },
  { key: "budget", label: "10 - Budget", hint: "Less than 10k / 10-50k / 50k+", rows: 0 },
  { key: "documentNeeds", label: "11 - Document Type", hint: "Tech Spec / Tokenomics / DeFi Audit", rows: 2 },
];

const INIT: Record<string, string> = {
  projectName: "", concept: "", problem: "", targetAudience: "",
  blockchain: "", existingCode: "", competitors: "", teamInfo: "",
  timeline: "", budget: "", documentNeeds: "",
};

const F: React.CSSProperties = {
  width: "100%", background: "var(--card2)",
  border: "1px solid var(--border2)", borderRadius: 6,
  padding: "10px 14px", fontSize: 13, color: "var(--bright)",
  fontFamily: "inherit", outline: "none",
};

export default function RunPage() {
  const [form, setForm] = useState<Record<string, string>>(INIT);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [meta, setMeta] = useState<{ costUsd: number; tokens: number } | null>(null);

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const run = async () => {
    if (!form.projectName) { setError("Enter project name"); return; }
    setStatus("running"); setResult(null); setError(""); setMeta(null);
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 300);
    try {
      const res = await fetch("/api/agents/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "p_" + Date.now(), intakeData: form }),
      });
      clearInterval(t);
      setElapsed(Math.floor((Date.now() - start) / 1000));
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Agent failed");
      setResult(data.data);
      setMeta({ costUsd: data.meta?.costUsd ?? 0, tokens: (data.meta?.inputTokens ?? 0) + (data.meta?.outputTokens ?? 0) });
      setStatus("done");
    } catch (e) {
      clearInterval(t);
      setError(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>
      <style>{"input::placeholder,textarea::placeholder{color:var(--dim);opacity:1}@keyframes spin{to{transform:rotate(360deg)}}"}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
        <Link href="/" style={{ color: "var(--dim)", fontSize: 13, textDecoration: "none" }}>Back</Link>
        <span style={{ color: "var(--border2)" }}>/</span>
        <span style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "var(--cyan)" }}>Research Agent</span>
      </div>

      {(status === "idle" || status === "error") && (
        <div>
          <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 20, fontWeight: 800, color: "var(--bright)", marginBottom: 6 }}>Intake Form</h2>
          <p style={{ fontSize: 12, color: "var(--dim)", marginBottom: 28 }}>Fill the form. Research Agent analyzes your project in about 45 seconds.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
            {FIELDS.map(({ key, label, hint, rows }) => (
              <div key={key}>
                <label style={{ display: "block", fontSize: 9, letterSpacing: "2px", textTransform: "uppercase", color: "var(--dim)", marginBottom: 6, fontWeight: 600 }}>{label}</label>
                {rows > 0 ? (
                  <textarea rows={rows} placeholder={hint} value={form[key]} onChange={e => set(key, e.target.value)} style={{ ...F, resize: "none", lineHeight: 1.6 }} />
                ) : (
                  <input type="text" placeholder={hint} value={form[key]} onChange={e => set(key, e.target.value)} style={F} />
                )}
              </div>
            ))}
          </div>
          {error && (
            <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 6, background: "rgba(176,40,40,0.1)", border: "1px solid rgba(176,40,40,0.3)", color: "#e05555", fontSize: 12 }}>
              {error}
            </div>
          )}
          <button onClick={run} style={{ width: "100%", padding: "14px", borderRadius: 7, background: "rgba(0,102,204,0.08)", border: "1px solid rgba(0,102,204,0.35)", color: "var(--cyan)", fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Run Research Agent
          </button>
        </div>
      )}

      {status === "running" && (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, color: "var(--cyan)" }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid var(--cyan)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
            <span style={{ fontSize: 13, letterSpacing: "3px", textTransform: "uppercase" }}>Research Agent {elapsed}s</span>
          </div>
          <p style={{ fontSize: 12, color: "var(--dim)", marginTop: 16 }}>Analyzing project, market and competitors...</p>
        </div>
      )}

      {status === "done" && result && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)" }} />
              <span style={{ fontSize: 12, color: "var(--green)" }}>Done in {elapsed}s</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {meta && (
                <span style={{ fontSize: 9, padding: "4px 10px", borderRadius: 4, background: "var(--card)", border: "1px solid var(--border)", color: "var(--dim)" }}>
                  {meta.tokens.toLocaleString()} tokens / ${meta.costUsd.toFixed(4)}
                </span>
              )}
              <button onClick={() => { setStatus("idle"); setResult(null); }} style={{ fontSize: 9, padding: "4px 10px", borderRadius: 4, background: "var(--card)", border: "1px solid var(--border)", color: "var(--dim)", cursor: "pointer", fontFamily: "inherit" }}>
                New
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(result).map(([key, val]) => (
              <div key={key} style={{ borderRadius: 8, background: "var(--card)", border: key === "redFlags" ? "1px solid rgba(176,40,40,0.2)" : "1px solid var(--border)", overflow: "hidden" }}>
                <div style={{ padding: "7px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: key === "redFlags" ? "var(--red)" : key === "opportunities" ? "var(--green)" : "var(--cyan)" }} />
                  <span style={{ fontSize: 9, letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 700, color: key === "redFlags" ? "var(--red)" : key === "opportunities" ? "var(--green)" : "var(--cyan)" }}>
                    {key.replace(/([A-Z])/g, " $1")}
                  </span>
                </div>
                <div style={{ padding: "10px 14px", fontSize: 11, color: "var(--text)", lineHeight: 1.7 }}>
                  {typeof val === "string" ? val : JSON.stringify(val, null, 2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
