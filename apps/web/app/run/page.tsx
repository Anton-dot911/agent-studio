“use client”;
// apps/web/app/run/page.tsx

import { useState } from “react”;
import Link from “next/link”;
import type { IntakeFormData, ResearchReport } from “@agent-studio/agents”;

type RunStatus = “idle” | “running” | “done” | “error”;

const INITIAL_FORM: IntakeFormData = {
projectName: “”,
concept: “”,
problem: “”,
targetAudience: “”,
blockchain: “”,
existingCode: “”,
competitors: “”,
teamInfo: “”,
timeline: “”,
budget: “”,
documentNeeds: “”,
};

const FIELDS: { key: keyof IntakeFormData; label: string; hint: string; rows?: number }[] = [
{ key: “projectName”, label: “01 · Назва проєкту”, hint: “Коротка назва” },
{ key: “concept”, label: “02 · Концепція”, hint: “3–5 речень що будуєте”, rows: 3 },
{ key: “problem”, label: “03 · Проблема”, hint: “Яку проблему вирішує?”, rows: 2 },
{ key: “targetAudience”, label: “04 · Аудиторія”, hint: “Хто користувач?” },
{ key: “blockchain”, label: “05 · Блокчейн”, hint: “Base, Ethereum, Solana, або N/A” },
{ key: “existingCode”, label: “06 · Існуючий код”, hint: “Посилання або ‘немає’” },
{ key: “competitors”, label: “07 · Конкуренти”, hint: “Через кому: Uniswap, Aave…” },
{ key: “teamInfo”, label: “08 · Команда”, hint: “Розмір і досвід” },
{ key: “timeline”, label: “09 · Таймлайн”, hint: “MVP за скільки?” },
{ key: “budget”, label: “10 · Бюджет”, hint: “<$10k / $10-50k / $50k+” },
{ key: “documentNeeds”, label: “11 · Що потрібно”, hint: “Tech Spec / Tokenomics / DeFi Audit”, rows: 2 },
];

// ─── Inline styles for fields (guarantees visibility on all platforms) ────────
const fieldBase: React.CSSProperties = {
width: “100%”,
background: “#0f1220”,
border: “1px solid #2a3560”,
borderRadius: “6px”,
padding: “10px 14px”,
fontSize: “13px”,
color: “#eef4ff”,
fontFamily: “inherit”,
outline: “none”,
transition: “border-color 0.2s”,
};

const placeholderStyle = `input::placeholder, textarea::placeholder { color: #7a90b8 !important; opacity: 1 !important; } input:focus, textarea:focus { border-color: rgba(0, 212, 255, 0.5) !important; } label { color: #7a90b8; }`;

export default function RunPage() {
const [form, setForm] = useState<IntakeFormData>(INITIAL_FORM);
const [status, setStatus] = useState<RunStatus>(“idle”);
const [result, setResult] = useState<ResearchReport | null>(null);
const [error, setError] = useState(””);
const [elapsed, setElapsed] = useState(0);
const [meta, setMeta] = useState<{ costUsd: number; tokens: number } | null>(null);

const handleChange = (key: keyof IntakeFormData, value: string) => {
setForm((prev) => ({ …prev, [key]: value }));
};

const handleRun = async () => {
if (!form.projectName || !form.concept) {
setError(“Заповніть хоча б назву і концепцію”);
return;
}

```
setStatus("running");
setResult(null);
setError("");
setMeta(null);

const start = Date.now();
const timer = setInterval(
  () => setElapsed(Math.floor((Date.now() - start) / 1000)),
  300
);

try {
  const res = await fetch("/api/agents/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: `project_${Date.now()}`,
      intakeData: form,
    }),
  });

  clearInterval(timer);
  setElapsed(Math.floor((Date.now() - start) / 1000));

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(data.error || "Agent failed");
  }

  setResult(data.data as ResearchReport);
  setMeta({
    costUsd: data.meta?.costUsd ?? 0,
    tokens: (data.meta?.inputTokens ?? 0) + (data.meta?.outputTokens ?? 0),
  });
  setStatus("done");
} catch (e) {
  clearInterval(timer);
  setError(e instanceof Error ? e.message : "Unknown error");
  setStatus("error");
}
```

};

return (
<main style={{ maxWidth: 720, margin: “0 auto”, padding: “32px 20px” }}>
<style>{placeholderStyle}</style>

```
  {/* Header */}
  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
    <Link href="/" style={{ color: "#7a90b8", fontSize: 13, textDecoration: "none" }}>
      ← Dashboard
    </Link>
    <span style={{ color: "#2a3560" }}>/</span>
    <span style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "#00d4ff" }}>
      Research Agent
    </span>
  </div>

  {/* Form */}
  {(status === "idle" || status === "error") && (
    <div>
      <h2 style={{ fontFamily: "Syne, Arial, sans-serif", fontSize: 20, fontWeight: 800, color: "#eef4ff", marginBottom: 6 }}>
        Intake форма
      </h2>
      <p style={{ fontSize: 12, color: "#7a90b8", marginBottom: 28, lineHeight: 1.6 }}>
        Заповни → Research Agent проаналізує проєкт за ~45 секунд
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 24 }}>
        {FIELDS.map(({ key, label, hint, rows }) => (
          <div key={key}>
            <label style={{
              display: "block",
              fontSize: 9,
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "#7a90b8",
              marginBottom: 8,
              fontWeight: 600,
            }}>
              {label}
            </label>
            {rows ? (
              <textarea
                rows={rows}
                placeholder={hint}
                value={form[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                style={{ ...fieldBase, resize: "none", lineHeight: 1.6 }}
              />
            ) : (
              <input
                type="text"
                placeholder={hint}
                value={form[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                style={fieldBase}
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div style={{
          marginBottom: 16,
          padding: "12px 16px",
          borderRadius: 6,
          background: "rgba(224,85,85,0.1)",
          border: "1px solid rgba(224,85,85,0.3)",
          color: "#f87171",
          fontSize: 12,
        }}>
          ⚠ {error}
        </div>
      )}

      <button
        onClick={handleRun}
        style={{
          width: "100%",
          padding: "14px",
          borderRadius: 7,
          background: "rgba(0,212,255,0.08)",
          border: "1px solid rgba(0,212,255,0.35)",
          color: "#00d4ff",
          fontSize: 10,
          letterSpacing: "2px",
          textTransform: "uppercase",
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "all 0.2s",
        }}
      >
        ⬡ Запустити Research Agent
      </button>
    </div>
  )}

  {/* Running */}
  {status === "running" && (
    <div style={{ textAlign: "center", padding: "80px 0" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 12, color: "#00d4ff" }}>
        <div style={{
          width: 20, height: 20, borderRadius: "50%",
          border: "2px solid #00d4ff", borderTopColor: "transparent",
          animation: "spin 0.8s linear infinite",
        }} />
        <span style={{ fontSize: 13, letterSpacing: "3px", textTransform: "uppercase" }}>
          Research Agent · {elapsed}s
        </span>
      </div>
      <p style={{ fontSize: 12, color: "#7a90b8", marginTop: 16 }}>
        Аналізую проєкт, ринок і конкурентів...
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )}

  {/* Result */}
  {status === "done" && result && (
    <div>
      {/* Meta bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 20, flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2ecc8f" }} />
          <span style={{ fontSize: 12, color: "#2ecc8f" }}>Готово за {elapsed}s</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {meta && (
            <>
              <span style={{
                fontSize: 9, padding: "4px 10px", borderRadius: 4,
                background: "#0b0e18", border: "1px solid #2a3560", color: "#7a90b8",
              }}>
                {meta.tokens.toLocaleString()} токенів
              </span>
              <span style={{
                fontSize: 9, padding: "4px 10px", borderRadius: 4,
                background: "#0b0e18", border: "1px solid #2a3560", color: "#7a90b8",
              }}>
                ${meta.costUsd.toFixed(4)}
              </span>
            </>
          )}
          <button
            onClick={() => { setStatus("idle"); setResult(null); }}
            style={{
              fontSize: 9, padding: "4px 10px", borderRadius: 4,
              background: "#0b0e18", border: "1px solid #2a3560", color: "#7a90b8",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ↺ Новий
          </button>
        </div>
      </div>

      <ReportView report={result} />
    </div>
  )}
</main>
```

);
}

// ─── Report rendering ─────────────────────────────────────────────────────────

function ReportView({ report }: { report: ResearchReport }) {
const sections = [
{ key: “projectSummary”,      label: “Project Summary”,        accent: “#00d4ff”, content: report.projectSummary },
{ key: “problemAnalysis”,     label: “Problem Analysis”,       accent: “#f472b6”, content: report.problemAnalysis },
{ key: “marketContext”,       label: “Market Context”,         accent: “#2ecc8f”, content: report.marketContext },
{ key: “competitiveAnalysis”, label: “Competitive Analysis”,   accent: “#8b7ff0”, content: report.competitiveAnalysis },
{ key: “technicalLandscape”,  label: “Technical Landscape”,    accent: “#f0843a”, content: report.technicalLandscape },
{ key: “teamAssessment”,      label: “Team Assessment”,        accent: “#e0b84a”, content: report.teamAssessment },
{ key: “redFlags”,            label: “⚠ Red Flags”,            accent: “#e05555”, content: report.redFlags },
{ key: “opportunities”,       label: “Opportunities”,          accent: “#2ecc8f”, content: report.opportunities },
{ key: “notesForWriter”,      label: “Notes for Writer Agent”, accent: “#7a90b8”, content: report.notesForWriter },
];

return (
<div style={{ display: “flex”, flexDirection: “column”, gap: 10 }}>
{sections.map(({ key, label, accent, content }) => (
<div key={key} style={{
borderRadius: 8,
background: “#0b0e18”,
border: `1px solid ${key === "redFlags" ? "rgba(224,85,85,0.2)" : "#1e2540"}`,
overflow: “hidden”,
}}>
<div style={{
padding: “8px 16px”,
borderBottom: “1px solid #1e2540”,
display: “flex”, alignItems: “center”, gap: 8,
}}>
<div style={{
width: 6, height: 6, borderRadius: “50%”,
background: accent, boxShadow: `0 0 4px ${accent}`,
}} />
<span style={{
fontSize: 9, letterSpacing: “1.5px”, textTransform: “uppercase”,
fontWeight: 700, color: accent,
}}>
{label}
</span>
</div>
<div style={{ padding: “12px 16px” }}>
<ContentRenderer content={content} />
</div>
</div>
))}
</div>
);
}

function ContentRenderer({ content }: { content: unknown }) {
if (typeof content === “string”) {
return (
<p style={{ fontSize: 12, color: “#c8d8f0”, lineHeight: 1.75, margin: 0 }}>
{content}
</p>
);
}
if (Array.isArray(content)) {
return (
<ul style={{ listStyle: “none”, padding: 0, margin: 0 }}>
{content.map((item, i) => (
<li key={i} style={{ display: “flex”, gap: 10, marginBottom: 6 }}>
<span style={{ color: “#7a90b8”, flexShrink: 0, marginTop: 2 }}>▸</span>
<ContentRenderer content={item} />
</li>
))}
</ul>
);
}
if (content && typeof content === “object”) {
return (
<div style={{ display: “flex”, flexDirection: “column”, gap: 8 }}>
{Object.entries(content as Record<string, unknown>).map(([k, v]) => (
<div key={k} style={{ display: “flex”, gap: 12 }}>
<span style={{
fontSize: 9, textTransform: “uppercase”, letterSpacing: “1px”,
color: “#7a90b8”, flexShrink: 0, minWidth: 110, paddingTop: 2,
}}>
{k}
</span>
<span style={{ color: “#c8d8f0”, fontSize: 12, lineHeight: 1.7 }}>
<ContentRenderer content={v} />
</span>
</div>
))}
</div>
);
}
return (
<span style={{ fontSize: 12, color: “#c8d8f0” }}>{String(content)}</span>
);
}
