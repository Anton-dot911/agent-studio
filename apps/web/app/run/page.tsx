"use client";
import { useState } from "react";
import Link from "next/link";

type RunStatus = "idle" | "running" | "done" | "error" | "writing" | "document";

type Block =
  | { type: "para"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "highlight"; label: string; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; text: string };
type Section = { label: string; blocks: Block[] };
type TechSpec = { title: string; subtitle: string; sections: Section[] };

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
  width: "100%", borderRadius: 12, padding: "13px 15px", fontSize: 14, fontFamily: "inherit",
};

export default function RunPage() {
  const [form, setForm] = useState<Record<string, string>>(INIT);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [spec, setSpec] = useState<TechSpec | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [meta, setMeta] = useState<{ costUsd: number; tokens: number } | null>(null);

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  const card = { background: "var(--card)", borderRadius: 16, boxShadow: "var(--nm-out)" } as React.CSSProperties;

  const run = async () => {
    if (!form.projectName) { setError("Enter a project name to continue"); return; }
    setStatus("running"); setResult(null); setSpec(null); setError(""); setMeta(null);
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
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); }
      catch { throw new Error("Server error (HTTP " + res.status + "): " + raw.slice(0, 220)); }
      if (!res.ok || !data.success) throw new Error(data.error || ("HTTP " + res.status));
      setResult(data.data);
      setMeta({ costUsd: data.meta?.costUsd ?? 0, tokens: (data.meta?.inputTokens ?? 0) + (data.meta?.outputTokens ?? 0) });
      setStatus("done");
    } catch (e) {
      clearInterval(t);
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setStatus("error");
    }
  };

  const generateDoc = async () => {
    setStatus("writing"); setError("");
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 300);
    try {
      const res = await fetch("/api/agents/writer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "p_" + Date.now(), intakeData: form, researchReport: result }),
      });
      clearInterval(t);
      setElapsed(Math.floor((Date.now() - start) / 1000));
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); }
      catch { throw new Error("Server error (HTTP " + res.status + "): " + raw.slice(0, 220)); }
      if (!res.ok || !data.success) throw new Error(data.error || ("HTTP " + res.status));
      setSpec(data.data);
      setMeta({ costUsd: data.meta?.costUsd ?? 0, tokens: (data.meta?.inputTokens ?? 0) + (data.meta?.outputTokens ?? 0) });
      setStatus("document");
    } catch (e) {
      clearInterval(t);
      setError(e instanceof Error ? e.message : "Writer failed. Try again.");
      setStatus("done");
    }
  };

  // ---------- DOCUMENT VIEW (corporate template + print) ----------
  if (status === "document" && spec) {
    return (
      <>
        <style>{`
          @media screen {
            .doc-wrap { max-width: 760px; margin: 0 auto; padding: 24px 16px 80px; }
            .doc-bar { position: sticky; top: 0; z-index: 10; display: flex; gap: 10px;
              padding: 12px 0; background: var(--bg); margin-bottom: 18px; flex-wrap: wrap; }
            .doc-page { background: #ffffff; border-radius: 10px; box-shadow: var(--nm-out);
              overflow: hidden; color: #1a1a2e; }
          }
          @media print {
            .doc-bar { display: none !important; }
            .doc-wrap { max-width: none; margin: 0; padding: 0; }
            .doc-page { box-shadow: none; border-radius: 0; }
            body { background: #fff !important; }
            .sec { break-inside: avoid; }
          }
          .doc-page * { font-family: 'Helvetica Neue', Arial, sans-serif; }
          .cover { background: #0055b3; color: #fff; padding: 56px 44px; }
          .cover .badge { display: inline-block; font-size: 11px; letter-spacing: 2px;
            text-transform: uppercase; background: rgba(255,255,255,0.18);
            padding: 6px 12px; border-radius: 4px; margin-bottom: 22px; }
          .cover h1 { font-size: 30px; font-weight: 800; line-height: 1.2; margin-bottom: 12px; }
          .cover p { font-size: 15px; opacity: 0.92; line-height: 1.5; }
          .body { padding: 40px 44px; }
          .sec { margin-bottom: 34px; }
          .sec-label { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
          .sec-label .bar { width: 4px; height: 20px; background: #0055b3; border-radius: 2px; }
          .sec-label h2 { font-size: 18px; font-weight: 700; color: #0055b3; }
          .sec p.para { font-size: 13.5px; line-height: 1.7; color: #2a2a3a; margin-bottom: 12px; }
          .sec ul { margin: 0 0 12px 18px; }
          .sec li { font-size: 13.5px; line-height: 1.7; color: #2a2a3a; margin-bottom: 5px; }
          .hl { background: #eef4fc; border-left: 4px solid #0055b3; border-radius: 4px;
            padding: 14px 16px; margin-bottom: 14px; }
          .hl .hl-label { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
            color: #0055b3; font-weight: 700; margin-bottom: 6px; }
          .hl .hl-text { font-size: 13.5px; line-height: 1.6; color: #1a2a44; }
          table.spec { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 12.5px; }
          table.spec th { background: #0055b3; color: #fff; text-align: left; padding: 9px 12px; font-weight: 600; }
          table.spec td { padding: 9px 12px; border-bottom: 1px solid #e3e8f0; color: #2a2a3a; }
          table.spec tr:nth-child(even) td { background: #f6f9fd; }
          pre.code { background: #0d1530; color: #c8d4f0; padding: 14px 16px; border-radius: 6px;
            font-size: 12px; line-height: 1.6; overflow-x: auto; margin-bottom: 14px;
            font-family: 'Courier New', monospace !important; white-space: pre-wrap; }
          pre.code * { font-family: 'Courier New', monospace !important; }
          .foot { padding: 20px 44px; border-top: 1px solid #e3e8f0; font-size: 11px; color: #8a93a8; }
        `}</style>

        <div className="doc-wrap">
          <div className="doc-bar">
            <button onClick={() => setStatus("done")} style={{ fontSize: 12, padding: "9px 16px", borderRadius: 10, background: "var(--card)", boxShadow: "var(--nm-out-sm)", color: "var(--text)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Back</button>
            <button onClick={() => window.print()} style={{ fontSize: 12, padding: "9px 18px", borderRadius: 10, background: "var(--accent)", color: "#fff", boxShadow: "var(--nm-out-sm)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>Save as PDF</button>
            {meta && <span style={{ fontSize: 11, padding: "9px 12px", borderRadius: 10, background: "var(--card)", boxShadow: "var(--nm-out-sm)", color: "var(--dim)" }}>{meta.tokens.toLocaleString()} tok / ${meta.costUsd.toFixed(4)}</span>}
          </div>

          <div className="doc-page">
            <div className="cover">
              <span className="badge">Agent Studio</span>
              <h1>{spec.title}</h1>
              <p>{spec.subtitle}</p>
            </div>
            <div className="body">
              {spec.sections.map((sec, si) => (
                <div className="sec" key={si}>
                  <div className="sec-label"><div className="bar" /><h2>{sec.label}</h2></div>
                  {sec.blocks.map((b, bi) => {
                    if (b.type === "para") return <p className="para" key={bi}>{b.text}</p>;
                    if (b.type === "bullets") return <ul key={bi}>{b.items.map((it, ii) => <li key={ii}>{it}</li>)}</ul>;
                    if (b.type === "highlight") return <div className="hl" key={bi}><div className="hl-label">{b.label}</div><div className="hl-text">{b.text}</div></div>;
                    if (b.type === "code") return <pre className="code" key={bi}>{b.text}</pre>;
                    if (b.type === "table") return (
                      <table className="spec" key={bi}>
                        <thead><tr>{b.headers.map((h, hi) => <th key={hi}>{h}</th>)}</tr></thead>
                        <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}</tbody>
                      </table>
                    );
                    return null;
                  })}
                </div>
              ))}
            </div>
            <div className="foot">Generated by Agent Studio - {spec.title} - Confidential</div>
          </div>
        </div>
      </>
    );
  }

  // ---------- MAIN FLOW ----------
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
                {rows > 0
                  ? <textarea rows={rows} placeholder={hint} value={form[key]} onChange={e => set(key, e.target.value)} style={{ ...field, resize: "none", lineHeight: 1.6 }} />
                  : <input type="text" placeholder={hint} value={form[key]} onChange={e => set(key, e.target.value)} style={field} />}
              </div>
            ))}
          </div>
          {error && <div style={{ ...card, padding: "14px 16px", marginBottom: 16, color: "#c83838", fontSize: 13 }}>{error}</div>}
          <button onClick={run} style={{ width: "100%", padding: "16px", borderRadius: 13, background: "var(--accent)", color: "#fff", fontSize: 12, letterSpacing: "2px", textTransform: "uppercase", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: "none", boxShadow: "var(--nm-out-sm)" }}>Run Research Agent</button>
        </div>
      )}

      {(status === "running" || status === "writing") && (
        <div style={{ textAlign: "center", padding: "90px 0" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, color: "var(--accent)" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", border: "3px solid var(--accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
            <span style={{ fontSize: 14, letterSpacing: "3px", textTransform: "uppercase" }}>{status === "writing" ? "Writing" : "Working"} {elapsed}s</span>
          </div>
          <p style={{ fontSize: 13, color: "var(--dim)", marginTop: 18 }}>{status === "writing" ? "Drafting the full technical specification..." : "Analyzing project, market and competitors..."}</p>
        </div>
      )}

      {status === "done" && result && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--green)" }} />
              <span style={{ fontSize: 13, color: "var(--green)", fontWeight: 600 }}>Research done in {elapsed}s</span>
            </div>
            <button onClick={() => { setStatus("idle"); setResult(null); setSpec(null); }} style={{ fontSize: 11, padding: "6px 14px", borderRadius: 9, background: "var(--card)", boxShadow: "var(--nm-out-sm)", color: "var(--text)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>New</button>
          </div>

          <button onClick={generateDoc} style={{ ...card, width: "100%", padding: "18px", marginBottom: 18, cursor: "pointer", border: "none", textAlign: "left", display: "block" }}>
            <p style={{ fontSize: 10, letterSpacing: "3px", textTransform: "uppercase", color: "var(--accent)", marginBottom: 8, fontWeight: 700 }}>Step 2</p>
            <p style={{ fontSize: 17, fontWeight: 700, color: "var(--bright)", marginBottom: 4 }}>Generate full Tech Spec</p>
            <p style={{ fontSize: 12.5, color: "var(--dim)", lineHeight: 1.5 }}>Writer Agent turns this research into a client-ready document you can save as PDF.</p>
          </button>

          {error && <div style={{ ...card, padding: "14px 16px", marginBottom: 16, color: "#c83838", fontSize: 13 }}>{error}</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {Object.entries(result).map(([key, val]) => {
              const accent = key === "redFlags" ? "#c83838" : key === "opportunities" ? "var(--green)" : "var(--accent)";
              return (
                <div key={key} style={{ ...card, overflow: "hidden" }}>
                  <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 9 }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent }} />
                    <span style={{ fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 700, color: accent }}>{key.replace(/([A-Z])/g, " $1")}</span>
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
