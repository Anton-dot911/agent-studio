"use client";
import { useState } from "react";
import Link from "next/link";

type RunStatus = "idle" | "running" | "done" | "error";

const FIELDS = [
  { key: "projectName", label: "01 - Project Name", hint: "Short name", rows: 0 },
  { key: "concept", label: "02 - Concept", hint: "3-5 sentences on what you are building", rows: 3 },
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

const field: React.CSSProperties = {
  width: "100%", borderRadius: 12,
  padding: "13px 15px", fontSize: 14,
  fontFamily: "inherit",
};

export default function RunPage() {
  const [form, setForm] = useState<Record<string, string>>(INIT);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [meta, setMeta] = useState<{ costUsd: number; tokens: number } | null>(null);

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const card = { background: "var(--card)", borderRadius: 16, boxShadow: "var(--nm-out)" } as React.CSSProperties;

  const run = async () => {
    if (!form.projectName) { setError("Enter a project name to continue"); return; }
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
      if (!res.ok || !data.success) throw new Error(data.error || "The agent could not finish. Try again.");
      setResult(data.data);
      setMeta({ costUsd: data.meta?.costUsd ?? 0, tokens: (data.meta?.inputTokens ?? 0) + (data.meta?.outputTokens ?? 0) });
      setStatus("done");
    } catch (e) {
      clearInterval(t);
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setStatus("error");
    }
  };

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "28px 18px 60px" }}>
      <style>{"input::placeholder,textarea::placeholder{color:var(--dim);opacity:1}@keyframes spin{to{transform:rotate(360deg)}}"}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 26 }}>
        <Link href="/" style={{ color: "var(--dim)", fontSize: 14, textDecoration: "none" }}>Back</Link>
        <span style={{ color: "var(--dim)" }}>/</span>
        <span style={{ fontSize: 11, letterSpacing: "3px", textTransform: "uppercase", color: "var(--accent)", fontWeight: 700 }}>Research Agent</span>
      </div>

      {(status === "idle" || status === "error") && (
        <div>
          <h2 style={{ fontSize: 25, fontWeight: 800, color: "var(--bright)", marginBottom: 8, letterSpacing: "-0.3px" }}>Intake form</h2>
          <p style={{ fontSize: 14, color: "var(--dim)", marginBottom: 26, lineHeight: 1.6 }}>Fill the fields below. The agent returns its analysis in about 45 seconds.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 24 }}>
            {FIELDS.map(({ key, label, hint, rows }) => (
              <div key={key}>
                <label style={{ display: "block", fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "var(--dim)", marginBottom: 8, fontWeight: 700 }}>{label}</label>
                {rows > 0 ? (
                  <textarea rows={rows} placeholder={hint} value={form[key]} onChange={e => set(key, e.target.value)} style={{ ...field, resize: "none", lineHeight: 1.6 }} />
                ) : (
                  <input type="text" placeholder={hint} value={form[key]} onChange={e => set(key, e.target.value)} style={field} />
                )}
              </div>
            ))}
          </div>

          {error && (
            <div style={{ ...card, padding: "14px 16px", marginBottom: 16, color: "#c83838", fontSize: 13 }}>
              {error}
            </div>
          )}

          <button onClick={run} style={{
            width: "100%", padding: "16px", borderRadius: 13,
            background: "var(--accent)", color: "#ffffff",
            fontSize: 12, letterSpacing: "2px", textTransform: "uppercase", fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", border: "none",
            boxShadow: "var(--nm-out-sm)",
          }}>
            Run Research Agent
          </button>
        </div>
      )}

      {status === "running" && (
        <div style={{ textAlign: "center", padding: "90px 0" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, color: "var(--accent)" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", border: "3px solid var(--accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
            <span style={{ fontSize: 14, letterSpacing: "3px", textTransform: "uppercase" }}>Working {elapsed}s</span>
          </div>
          <p style={{ fontSize: 13, color: "var(--dim)", marginTop: 18 }}>Analyzing project, market and competitors...</p>
        </div>
      )}

      {status === "done" && result && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--green)" }} />
              <span style={{ fontSize: 13, color: "var(--green)", fontWeight: 600 }}>Done in {elapsed}s</span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {meta && (
                <span style={{ fontSize: 11, padding: "6px 12px", borderRadius: 9, background: "var(--card)", boxShadow: "var(--nm-out-sm)", color: "var(--dim)" }}>
                  {meta.tokens.toLocaleString()} tokens / ${meta.costUsd.toFixed(4)}
                </span>
              )}
              <button onClick={() => { setStatus("idle"); setResult(null); }} style={{ fontSize: 11, padding: "6px 14px", borderRadius: 9, background: "var(--card)", boxShadow: "var(--nm-out-sm)", color: "var(--text)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                New
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {Object.entries(result).map(([key, val]) => {
              const accent = key === "redFlags" ? "#c83838" : key === "opportunities" ? "var(--green)" : "var(--accent)";
              return (
                <div key={key} style={{ ...card, overflow: "hidden" }}>
                  <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 9 }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent }} />
                    <span style={{ fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 700, color: accent }}>
                      {key.replace(/([A-Z])/g, " $1")}
                    </span>
                  </div>
                  <div style={{ padding: "0 18px 16px", fontSize: 13, color: "var(--text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                    {typeof val === "string" ? val : JSON.stringify(val, null, 2)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
