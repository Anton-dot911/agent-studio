"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Checkout, CheckoutButton, CheckoutStatus, type LifecycleStatus } from "@coinbase/onchainkit/checkout";

type RunStatus =
  | "idle"
  | "running"
  | "done"
  | "error"
  | "writing"
  | "document"
  | "qa_checking"
  | "qa_done"
  | "revising"
  | "delivering"
  | "delivered";

type DocBlock =
  | { type: "para"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "highlight"; label: string; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; text: string };

interface DocSection { label: string; blocks: DocBlock[] }
interface TechSpec { title: string; subtitle: string; sections: DocSection[] }

interface QAReport {
  score: number;
  status: "approved" | "minor_revisions" | "major_revisions";
  criticalIssues: string[];
  majorIssues: string[];
  minorIssues: string[];
  humanChecklist: string[];
  summary: string;
}

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
  { key: "documentNeeds", label: "11 - Document Type", hint: "", rows: 0 },
];

const INIT: Record<string, string> = {
  projectName: "", concept: "", problem: "", targetAudience: "",
  blockchain: "", existingCode: "", competitors: "", teamInfo: "",
  timeline: "", budget: "", documentNeeds: "Tech Spec",
};

const DOC_TYPES = [
  { value: "Tech Spec", label: "Tech Spec", desc: "Architecture, contracts, API, deployment" },
  { value: "Tokenomics", label: "Tokenomics", desc: "Token model, distribution, vesting, governance" },
  { value: "DeFi Audit", label: "DeFi Audit Prep", desc: "Attack vectors, security controls, remediation" },
];

const fieldStyle: React.CSSProperties = {
  width: "100%", borderRadius: 12, padding: "13px 15px", fontSize: 14, fontFamily: "inherit",
  background: "var(--card)", border: "1.5px solid rgba(15,18,64,0.10)", color: "var(--bright)",
};

export default function RunPage() {
  const [form, setForm] = useState<Record<string, string>>(INIT);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [researchResult, setResearchResult] = useState<Record<string, unknown> | null>(null);
  const [spec, setSpec] = useState<TechSpec | null>(null);
  const [qaReport, setQaReport] = useState<QAReport | null>(null);
  const [clientEmail, setClientEmail] = useState("");
  const [clientName, setClientName] = useState("");
  const [deliveryResult, setDeliveryResult] = useState<{ pdfGenerated: boolean; emailSent: boolean } | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [meta, setMeta] = useState<{ costUsd: number; tokens: number } | null>(null);
  const [wasRevised, setWasRevised] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  const card = { background: "var(--card)", borderRadius: 20, boxShadow: "var(--shadow)" } as React.CSSProperties;

  const startTimer = (cb: (elapsed: number) => void) => {
    const start = Date.now();
    const t = setInterval(() => cb(Math.floor((Date.now() - start) / 1000)), 300);
    return { stop: () => { clearInterval(t); return Math.floor((Date.now() - start) / 1000); } };
  };

  // ── SSE fetch helper ───────────────────────────────────────────────────────
  const fetchSSE = async (
    url: string,
    body: object
  ): Promise<{ data: Record<string, unknown>; meta: Record<string, unknown> }> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          const event = JSON.parse(json) as { type: string; success?: boolean; data?: Record<string, unknown>; meta?: Record<string, unknown>; error?: string };
          if (event.type === "done") {
            if (!event.success) throw new Error(event.error || "Agent failed");
            return { data: event.data ?? {}, meta: event.meta ?? {} };
          }
          if (event.type === "error") throw new Error(event.error || "Agent error");
        }
      }
    }

    throw new Error("Stream ended without result");
  };

  // ── Payment: create Coinbase Commerce charge ──────────────────────────────
  const chargeHandler = async (): Promise<string> => {
    setCheckoutError("");
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName: form.projectName, documentType: form.documentNeeds }),
    });
    const data = await res.json() as { chargeId?: string; error?: string };
    if (!res.ok || !data.chargeId) throw new Error(data.error ?? "Failed to create charge");
    return data.chargeId;
  };

  const handleCheckoutStatus = (s: LifecycleStatus) => {
    if (s.statusName === "success") {
      setIsPaid(true);
      setShowCheckout(false);
      runWriter();
    }
    if (s.statusName === "error") {
      setCheckoutError("Payment failed. Please try again.");
      setShowCheckout(false);
    }
  };

  // ── Step 1: Research ───────────────────────────────────────────────────────
  const runResearch = async () => {
    if (!form.projectName) { setError("Enter a project name to continue"); return; }
    setStatus("running"); setResearchResult(null); setSpec(null); setQaReport(null); setError(""); setMeta(null); setWasRevised(false); setIsPaid(false); setShowCheckout(false);
    const timer = startTimer(s => setElapsed(s));
    try {
      const { data, meta } = await fetchSSE("/api/agents/research", { projectId: "p_" + Date.now(), intakeData: form });
      const secs = timer.stop(); setElapsed(secs);
      setResearchResult(data);
      setMeta({ costUsd: (meta.costUsd as number) ?? 0, tokens: ((meta.inputTokens as number) ?? 0) + ((meta.outputTokens as number) ?? 0) });
      setStatus("done");
    } catch (e) {
      timer.stop();
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setStatus("error");
    }
  };

  // ── Step 2: Writer ─────────────────────────────────────────────────────────
  const runWriter = async () => {
    setStatus("writing"); setError("");
    const timer = startTimer(s => setElapsed(s));
    try {
      const { data, meta } = await fetchSSE("/api/agents/writer", { projectId: "p_" + Date.now(), intakeData: form, researchReport: researchResult });
      timer.stop();
      setSpec(data as unknown as TechSpec);
      setMeta({ costUsd: (meta.costUsd as number) ?? 0, tokens: ((meta.inputTokens as number) ?? 0) + ((meta.outputTokens as number) ?? 0) });
      setWasRevised(false);
      setStatus("document");
    } catch (e) {
      timer.stop();
      setError(e instanceof Error ? e.message : "Writer failed. Try again.");
      setStatus("done");
    }
  };

  // ── Step 3: QA ────────────────────────────────────────────────────────────
  const runQA = async () => {
    setStatus("qa_checking"); setError("");
    const timer = startTimer(s => setElapsed(s));
    try {
      const { data, meta } = await fetchSSE("/api/agents/qa", { techSpec: spec, researchReport: researchResult, documentType: form.documentNeeds });
      timer.stop();
      setQaReport(data as unknown as QAReport);
      setMeta({ costUsd: (meta.costUsd as number) ?? 0, tokens: ((meta.inputTokens as number) ?? 0) + ((meta.outputTokens as number) ?? 0) });
      setStatus("qa_done");
    } catch (e) {
      timer.stop();
      setError(e instanceof Error ? e.message : "QA failed. Try again.");
      setStatus("document");
    }
  };

  // ── Step 3b: Revise ────────────────────────────────────────────────────────
  const runRevise = async () => {
    setStatus("revising"); setError("");
    const timer = startTimer(s => setElapsed(s));
    try {
      const { data, meta } = await fetchSSE("/api/agents/revise", { techSpec: spec, qaReport, intakeData: form, documentType: form.documentNeeds });
      timer.stop();
      setSpec(data as unknown as TechSpec);
      setQaReport(null);
      setMeta({ costUsd: (meta.costUsd as number) ?? 0, tokens: ((meta.inputTokens as number) ?? 0) + ((meta.outputTokens as number) ?? 0) });
      setWasRevised(true);
      setStatus("document");
    } catch (e) {
      timer.stop();
      setError(e instanceof Error ? e.message : "Revision failed. Try again.");
      setStatus("qa_done");
    }
  };

  // ── Step 4: Deliver ────────────────────────────────────────────────────────
  const runDeliver = async () => {
    if (!clientEmail) { setError("Enter client email to deliver"); return; }
    setStatus("delivering"); setError("");
    const timer = startTimer(s => setElapsed(s));
    try {
      const res = await fetch("/api/agents/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ techSpec: spec, clientEmail, clientName, projectName: form.projectName }),
      });
      timer.stop();
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error("Server error: " + raw.slice(0, 200)); }
      if (!res.ok || !data.success) throw new Error(data.error || "HTTP " + res.status);
      setDeliveryResult(data.data);
      setStatus("delivered");
    } catch (e) {
      timer.stop();
      setError(e instanceof Error ? e.message : "Delivery failed.");
      setStatus("qa_done");
    }
  };

  // ── Document view (with QA toolbar) ───────────────────────────────────────
  if ((status === "document" || status === "qa_checking" || status === "qa_done" || status === "revising" || status === "delivering" || status === "delivered") && spec) {
    const showQABar = (status === "document" || status === "qa_checking") && !wasRevised;
    const showQAResult = status === "qa_done" || status === "revising" || status === "delivered" || status === "delivering";
    const canDownloadPdf = wasRevised || (qaReport !== null && qaReport.score >= 9);

    const qaColor = qaReport
      ? qaReport.score >= 8 ? "var(--green)" : qaReport.score >= 6 ? "#f59e0b" : "#ef4444"
      : "var(--accent)";

    return (
      <>
        <style>{`
          @media screen {
            .doc-wrap { max-width: 760px; margin: 0 auto; padding: 24px 16px 80px; }
            .doc-bar { position: sticky; top: 0; z-index: 10; display: flex; gap: 10px;
              padding: 12px 0; background: var(--bg); margin-bottom: 18px; flex-wrap: wrap; align-items: center; }
            .doc-page { background: #ffffff; border-radius: 10px; box-shadow: var(--nm-out); overflow: hidden; color: #1a1a2e; }
          }
          @media print {
            .doc-bar,.qa-panel,.delivery-panel { display: none !important; }
            .doc-wrap { max-width: none; margin: 0; padding: 0; }
            .doc-page { box-shadow: none; border-radius: 0; }
            body { background: #fff !important; }
            .sec { break-inside: avoid; }
          }
          .doc-page * { font-family: 'Helvetica Neue', Arial, sans-serif; }
          .cover { background: #0055b3; color: #fff; padding: 56px 44px; }
          .cover .badge { display: inline-block; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; background: rgba(255,255,255,0.18); padding: 6px 12px; border-radius: 4px; margin-bottom: 22px; }
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
          .hl { background: #eef4fc; border-left: 4px solid #0055b3; border-radius: 4px; padding: 14px 16px; margin-bottom: 14px; }
          .hl .hl-label { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #0055b3; font-weight: 700; margin-bottom: 6px; }
          .hl .hl-text { font-size: 13.5px; line-height: 1.6; color: #1a2a44; }
          table.spec { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 12.5px; }
          table.spec th { background: #0055b3; color: #fff; text-align: left; padding: 9px 12px; font-weight: 600; }
          table.spec td { padding: 9px 12px; border-bottom: 1px solid #e3e8f0; color: #2a2a3a; }
          table.spec tr:nth-child(even) td { background: #f6f9fd; }
          pre.code { background: #0d1530; color: #c8d4f0; padding: 14px 16px; border-radius: 6px; font-size: 12px; line-height: 1.6; overflow-x: auto; margin-bottom: 14px; font-family: 'Courier New', monospace !important; white-space: pre-wrap; }
          .foot { padding: 20px 44px; border-top: 1px solid #e3e8f0; font-size: 11px; color: #8a93a8; }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>

        <div className="doc-wrap">
          {/* Toolbar */}
          <div className="doc-bar">
            <button onClick={() => setStatus("done")} style={{ fontSize: 13, padding: "9px 20px", borderRadius: 50, background: "var(--card)", boxShadow: "var(--shadow-sm)", color: "var(--text)", border: "1.5px solid rgba(15,18,64,0.10)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>← Back</button>
            {canDownloadPdf && (
              <button onClick={() => window.print()} style={{ fontSize: 13, padding: "9px 22px", borderRadius: 50, background: "var(--accent)", color: "#fff", boxShadow: "0 4px 14px rgba(33,37,102,0.28)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Download PDF</button>
            )}

            {showQABar && (
              <button
                onClick={runQA}
                disabled={status === "qa_checking"}
                style={{ fontSize: 13, padding: "9px 22px", borderRadius: 50, background: status === "qa_checking" ? "var(--card)" : "#0f766e", color: status === "qa_checking" ? "var(--dim)" : "#fff", boxShadow: status === "qa_checking" ? "var(--shadow-sm)" : "0 4px 14px rgba(15,118,110,0.30)", border: status === "qa_checking" ? "1.5px solid rgba(15,18,64,0.10)" : "none", cursor: status === "qa_checking" ? "default" : "pointer", fontFamily: "inherit", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                {status === "qa_checking" && <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--dim)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />}
                {status === "qa_checking" ? `QA ${elapsed}s` : "Run QA Check"}
              </button>
            )}

            {showQAResult && qaReport && (
              <span style={{ fontSize: 13, padding: "9px 18px", borderRadius: 50, background: "var(--card)", boxShadow: "var(--shadow-sm)", border: "1.5px solid rgba(15,18,64,0.08)", color: qaColor, fontWeight: 700 }}>
                QA {qaReport.score}/10 — {qaReport.status.replace(/_/g, " ")}
              </span>
            )}

            {meta && <span style={{ fontSize: 12, padding: "8px 16px", borderRadius: 50, background: "var(--card)", boxShadow: "var(--shadow-sm)", border: "1.5px solid rgba(15,18,64,0.08)", color: "var(--dim)", marginLeft: "auto" }}>{meta.tokens.toLocaleString()} tok / ${meta.costUsd.toFixed(4)}</span>}
          </div>

          {/* Error banner in document view */}
          {error && (
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <p style={{ fontSize: 13, color: "#ef4444", lineHeight: 1.5, margin: 0 }}>{error}</p>
              <button onClick={() => setError("")} style={{ fontSize: 20, lineHeight: 1, background: "none", border: "none", cursor: "pointer", color: "#ef4444", flexShrink: 0, padding: 0 }}>×</button>
            </div>
          )}

          {/* QA Panel */}
          {showQAResult && qaReport && (
            <div className="qa-panel" style={{ ...card, padding: "20px", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: qaColor, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 20, fontWeight: 800, flexShrink: 0 }}>{qaReport.score}</div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "var(--bright)", marginBottom: 3 }}>QA Report — {qaReport.status.replace(/_/g, " ")}</p>
                  <p style={{ fontSize: 12.5, color: "var(--dim)", lineHeight: 1.5 }}>{qaReport.summary}</p>
                </div>
              </div>

              {qaReport.criticalIssues.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "#ef4444", fontWeight: 700, marginBottom: 6 }}>Critical Issues</p>
                  {qaReport.criticalIssues.map((iss, i) => <p key={i} style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5, marginBottom: 4 }}>• {iss}</p>)}
                </div>
              )}

              {qaReport.majorIssues.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "#f59e0b", fontWeight: 700, marginBottom: 6 }}>Major Issues</p>
                  {qaReport.majorIssues.map((iss, i) => <p key={i} style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5, marginBottom: 4 }}>• {iss}</p>)}
                </div>
              )}

              {qaReport.minorIssues.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "var(--dim)", fontWeight: 700, marginBottom: 6 }}>Minor Issues</p>
                  {qaReport.minorIssues.map((iss, i) => <p key={i} style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5, marginBottom: 4 }}>• {iss}</p>)}
                </div>
              )}

              {/* score >= 9: ready, show Download PDF */}
              {qaReport.score >= 9 && (
                <button onClick={() => window.print()} style={{ width: "100%", padding: "14px 18px", borderRadius: 50, background: "var(--green)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14, boxShadow: "0 4px 16px rgba(16,185,129,0.30)", marginBottom: 14 }}>
                  Download PDF
                </button>
              )}

              {/* score < 9: show Checklist + Revise button */}
              {qaReport.score < 9 && (
                <>
                  {qaReport.humanChecklist.length > 0 && (
                    <div style={{ background: "var(--bg)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                      <p style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "var(--accent)", fontWeight: 700, marginBottom: 8 }}>Checklist</p>
                      {qaReport.humanChecklist.map((item, i) => (
                        <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                          <input type="checkbox" style={{ marginTop: 2, flexShrink: 0 }} />
                          <span style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5 }}>{item}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {status === "qa_done" && (
                    <div style={{ marginBottom: 14 }}>
                      <button onClick={runRevise} style={{ width: "100%", padding: "14px 18px", borderRadius: 50, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14, boxShadow: "0 4px 16px rgba(33,37,102,0.28)" }}>
                        Застосувати ревізію
                      </button>
                      <p style={{ fontSize: 11, color: "var(--dim)", marginTop: 6, textAlign: "center" }}>Reviser виправить документ за пунктами Checklist</p>
                    </div>
                  )}
                </>
              )}

              {status === "revising" && (
                <div style={{ marginBottom: 14, textAlign: "center", padding: "12px 0" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "var(--accent)" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid var(--accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
                    <span style={{ fontSize: 12, letterSpacing: "2px", textTransform: "uppercase", fontWeight: 700 }}>Пише новий документ... {elapsed}s</span>
                  </div>
                </div>
              )}

              {/* Delivery form */}
              {status !== "delivered" && status !== "revising" && (
                <div className="delivery-panel">
                  <p style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "var(--dim)", fontWeight: 700, marginBottom: 10 }}>Send to Client</p>
                  <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                    <input
                      type="email"
                      placeholder="client@email.com"
                      value={clientEmail}
                      onChange={e => setClientEmail(e.target.value)}
                      style={{ flex: 1, minWidth: 180, borderRadius: 10, padding: "11px 13px", fontSize: 13, fontFamily: "inherit" }}
                    />
                    <input
                      type="text"
                      placeholder="Client name (optional)"
                      value={clientName}
                      onChange={e => setClientName(e.target.value)}
                      style={{ flex: 1, minWidth: 140, borderRadius: 10, padding: "11px 13px", fontSize: 13, fontFamily: "inherit" }}
                    />
                    <button
                      onClick={runDeliver}
                      disabled={status === "delivering"}
                      style={{ padding: "11px 24px", borderRadius: 50, background: "var(--accent)", color: "#fff", border: "none", cursor: status === "delivering" ? "default" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 4px 14px rgba(33,37,102,0.28)", whiteSpace: "nowrap" }}>
                      {status === "delivering" ? <><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", animation: "spin 0.8s linear infinite" }} />{elapsed}s</> : "Deliver"}
                    </button>
                  </div>
                  {error && <p style={{ fontSize: 12.5, color: "#ef4444" }}>{error}</p>}
                </div>
              )}

              {/* Delivery success */}
              {status === "delivered" && deliveryResult && (
                <div style={{ background: "rgba(16, 185, 129, 0.08)", borderRadius: 10, padding: "14px 16px", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "var(--green)", marginBottom: 6 }}>Delivered</p>
                  <p style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.6 }}>
                    {deliveryResult.emailSent ? `Email sent to ${clientEmail}` : "Email delivery skipped (no RESEND_API_KEY configured)"}
                    {deliveryResult.pdfGenerated ? " · PDF generated via PDFShift" : " · Use Save as PDF for browser print"}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Post-revision success card */}
          {wasRevised && status === "document" && (
            <div style={{ ...card, padding: "20px 22px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", border: "1.5px solid rgba(16,185,129,0.20)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(16,185,129,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>✓</div>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "var(--bright)", marginBottom: 2 }}>Документ виправлено</p>
                  <p style={{ fontSize: 12, color: "var(--dim)" }}>Всі пункти Checklist враховані. Готово до завантаження.</p>
                </div>
              </div>
              <button onClick={() => window.print()} style={{ padding: "12px 28px", borderRadius: 50, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14, boxShadow: "0 4px 16px rgba(33,37,102,0.28)", whiteSpace: "nowrap" }}>
                Download PDF
              </button>
            </div>
          )}

          {/* Document */}
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
            <div className="foot">Generated by Agent Studio — {spec.title} — Confidential</div>
          </div>
        </div>
      </>
    );
  }

  // ── Main flow ──────────────────────────────────────────────────────────────
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "28px 18px 60px" }}>
      <style>{"input::placeholder,textarea::placeholder{color:var(--dim);opacity:1}@keyframes spin{to{transform:rotate(360deg)}}"}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 26 }}>
        <Link href="/" style={{ color: "var(--dim)", fontSize: 14, textDecoration: "none" }}>Back</Link>
        <span style={{ color: "var(--dim)" }}>/</span>
        <span style={{ fontSize: 11, letterSpacing: "3px", textTransform: "uppercase", color: "var(--accent)", fontWeight: 700 }}>
          {status === "done" ? "Research Agent" : status === "writing" ? "Writer Agent" : "Research Agent"}
        </span>
      </div>

      {(status === "idle" || status === "error") && (
        <div>
          <h2 style={{ fontSize: 25, fontWeight: 800, color: "var(--bright)", marginBottom: 8, letterSpacing: "-0.3px" }}>Intake form</h2>
          <p style={{ fontSize: 14, color: "var(--dim)", marginBottom: 26, lineHeight: 1.6 }}>Fill the fields below. The agent returns its analysis in about 45 seconds.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 24 }}>
            {FIELDS.map(({ key, label, hint, rows }) => {
              if (key === "documentNeeds") {
                return (
                  <div key={key}>
                    <label style={{ display: "block", fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "var(--dim)", marginBottom: 8, fontWeight: 700 }}>{label}</label>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {DOC_TYPES.map(dt => (
                        <button
                          key={dt.value}
                          type="button"
                          onClick={() => set("documentNeeds", dt.value)}
                          style={{ flex: 1, minWidth: 120, padding: "14px 14px", borderRadius: 16, border: form.documentNeeds === dt.value ? "2px solid var(--accent)" : "1.5px solid rgba(15,18,64,0.10)", background: form.documentNeeds === dt.value ? "rgba(33,37,102,0.05)" : "var(--card)", boxShadow: "var(--shadow-sm)", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                          <p style={{ fontSize: 12, fontWeight: 700, color: form.documentNeeds === dt.value ? "var(--accent)" : "var(--bright)", marginBottom: 3 }}>{dt.label}</p>
                          <p style={{ fontSize: 11, color: "var(--dim)", lineHeight: 1.4 }}>{dt.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }
              return (
                <div key={key}>
                  <label style={{ display: "block", fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "var(--dim)", marginBottom: 8, fontWeight: 700 }}>{label}</label>
                  {rows > 0
                    ? <textarea rows={rows} placeholder={hint} value={form[key]} onChange={e => set(key, e.target.value)} style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }} />
                    : <input type="text" placeholder={hint} value={form[key]} onChange={e => set(key, e.target.value)} style={fieldStyle} />}
                </div>
              );
            })}
          </div>
          {error && <div style={{ ...card, padding: "14px 16px", marginBottom: 16, color: "#c83838", fontSize: 13 }}>{error}</div>}
          <button onClick={runResearch} style={{ width: "100%", padding: "18px", borderRadius: 50, background: "var(--accent)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: "none", boxShadow: "0 4px 16px rgba(33,37,102,0.30)", letterSpacing: "0.3px" }}>Run Research Agent</button>
        </div>
      )}

      {(status === "running" || status === "writing") && (
        <div style={{ textAlign: "center", padding: "90px 0" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, color: "var(--accent)" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", border: "3px solid var(--accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
            <span style={{ fontSize: 14, letterSpacing: "3px", textTransform: "uppercase" }}>{status === "writing" ? "Writing" : "Researching"} {elapsed}s</span>
          </div>
          <p style={{ fontSize: 13, color: "var(--dim)", marginTop: 18 }}>
            {status === "writing" ? "Drafting the full technical specification..." : "Analyzing project, market and competitors..."}
          </p>
          {/* Pipeline progress */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 32 }}>
            {["Research", "Writer", "QA", "Deliver"].map((step, i) => (
              <div key={step} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ padding: "5px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: (status === "running" && i === 0) || (status === "writing" && i === 1) ? "var(--accent)" : "var(--card)", color: (status === "running" && i === 0) || (status === "writing" && i === 1) ? "#fff" : "var(--dim)", boxShadow: "var(--nm-out-sm)" }}>{step}</div>
                {i < 3 && <span style={{ color: "var(--dim)", fontSize: 12 }}>→</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {status === "done" && researchResult && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--green)" }} />
              <span style={{ fontSize: 13, color: "var(--green)", fontWeight: 600 }}>Research done in {elapsed}s</span>
            </div>
            <button onClick={() => { setStatus("idle"); setResearchResult(null); setSpec(null); }} style={{ fontSize: 12, padding: "7px 18px", borderRadius: 50, background: "var(--card)", boxShadow: "var(--shadow-sm)", color: "var(--text)", border: "1.5px solid rgba(15,18,64,0.10)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>New</button>
          </div>

          {/* Step 2: Payment gate → Writer */}
          {!isPaid && !showCheckout && (
            <div style={{ ...card, padding: "20px 22px", marginBottom: 18, border: "1.5px solid rgba(15,18,64,0.06)" }}>
              <p style={{ fontSize: 10, letterSpacing: "3px", textTransform: "uppercase", color: "var(--accent)", marginBottom: 8, fontWeight: 700 }}>Step 2</p>
              <p style={{ fontSize: 17, fontWeight: 700, color: "var(--bright)", marginBottom: 4 }}>Generate full document</p>
              <p style={{ fontSize: 12.5, color: "var(--dim)", lineHeight: 1.5, marginBottom: 16 }}>Writer → QA → Revise → PDF. One-time payment of <strong>$1 USDC</strong> on Base Sepolia.</p>
              <button onClick={() => setShowCheckout(true)} style={{ width: "100%", padding: "14px 18px", borderRadius: 50, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14, boxShadow: "0 4px 16px rgba(33,37,102,0.28)" }}>
                Pay $1 USDC &amp; Generate
              </button>
              {checkoutError && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 8 }}>{checkoutError}</p>}
            </div>
          )}

          {/* Coinbase Commerce Checkout */}
          {showCheckout && !isPaid && (
            <div style={{ ...card, padding: "20px 22px", marginBottom: 18 }}>
              <p style={{ fontSize: 10, letterSpacing: "3px", textTransform: "uppercase", color: "var(--accent)", marginBottom: 12, fontWeight: 700 }}>Payment</p>
              <Checkout chargeHandler={chargeHandler} onStatus={handleCheckoutStatus}>
                <CheckoutButton />
                <CheckoutStatus />
              </Checkout>
              {checkoutError && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 8 }}>{checkoutError}</p>}
              <button onClick={() => setShowCheckout(false)} style={{ width: "100%", marginTop: 10, padding: "10px", borderRadius: 50, background: "none", border: "1.5px solid rgba(15,18,64,0.12)", cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: "var(--dim)" }}>Cancel</button>
            </div>
          )}

          {error && <div style={{ ...card, padding: "14px 16px", marginBottom: 16, color: "#c83838", fontSize: 13 }}>{error}</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {Object.entries(researchResult).map(([key, val]) => {
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
