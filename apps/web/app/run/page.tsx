"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { PayAndGenerate } from "../../components/PayAndGenerate";
// Agent Studio talks to the DCL only through the adapter (lib/dcl-adapter), which
// binds the generic DCL core to this app's roles, taxonomy, and intake form.
import {
  ENABLE_DCL,
  materialize,
  seedBaseContextItems,
  baseContextFromIntake,
  buildAndRender,
  type AgentRole,
  type ContextItem,
  type ContextStatus,
} from "../../lib/dcl-adapter";
import { pdfBlobFromSpec, pdfBase64FromSpec } from "../../lib/pdf/clientPdf";

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

const PRESETS: { label: string; data: Record<string, string> }[] = [
  {
    label: "ProofFlow AI",
    data: {
      projectName: "ProofFlow AI",
      concept: "ProofFlow AI is an AI-powered verification platform for Web3 teams that automatically reviews project documentation, smart contract architecture, tokenomics assumptions, and public claims before launch. The system compares whitepapers, GitHub repositories, contract ABIs, token distribution data, and website content to detect inconsistencies, missing security details, unrealistic promises, and potential investor-risk signals. It generates a structured technical risk report for founders, auditors, launchpads, and early investors.",
      problem: "Web3 projects often publish incomplete or inconsistent technical documentation before launch. Investors, auditors, and launchpads waste time manually checking claims, tokenomics, contract structure, and security readiness. There is no simple automated pre-audit layer that detects documentation gaps, technical contradictions, and launch risks before expensive manual review.",
      targetAudience: "Web3 startup founders, smart contract auditors, launchpads, venture analysts, DAO contributors, token investors, and accelerator programs that review early-stage blockchain projects.",
      blockchain: "Ethereum, Base, Arbitrum, Polygon, or N/A",
      existingCode: "None",
      competitors: "CertiK Skynet, Token Sniffer, De.Fi Scanner, RugDoc, SolidityScan, GoPlus Security, Dune dashboards, manual audit firms",
      teamInfo: "2 full-stack developers, 1 AI/LLM engineer, 1 smart contract/security specialist, 1 product designer",
      timeline: "MVP 10 weeks",
      budget: "$40k-70k",
      documentNeeds: "Tech Spec",
    },
  },
  {
    label: "AgentOps TrustLayer",
    data: {
      projectName: "AgentOps TrustLayer",
      concept: "AgentOps TrustLayer is a control, monitoring, and compliance platform for companies deploying AI agents in real business workflows. It provides permission management, tool access policies, budget limits, human approvals, action logs, risk scoring, rollback workflows, and compliance reports for every AI agent action. The system allows companies to safely connect AI agents to Gmail, Slack, CRMs, databases, APIs, payment systems, and internal tools without giving them uncontrolled access. It works as a security and governance layer between AI agents and external systems.",
      problem: "Companies want to use AI agents to automate real work, but they cannot safely allow autonomous systems to access sensitive data, send emails, execute payments, modify databases, or trigger business workflows without control. The main problems are lack of visibility, weak permissions, no audit trail, unclear responsibility, prompt injection risks, data leaks, and compliance pressure. Businesses need a practical AgentOps layer before they can deploy AI agents at scale.",
      targetAudience: "Enterprise SaaS companies, AI automation agencies, internal IT teams, compliance teams, fintech companies, legal-tech platforms, healthcare software vendors, CRM providers, Web3 teams, and startups building AI agent products.",
      blockchain: "N/A, optional Base or Ethereum for tamper-proof audit logs and payment verification",
      existingCode: "None",
      competitors: "LangSmith, Langfuse, OpenAI Evals, Humanloop, Credo AI, Lakera, Prompt Security, WorkOS, Auth0, Vanta, Drata, traditional SIEM tools",
      teamInfo: "2 full-stack developers, 1 AI/LLM engineer, 1 security engineer, 1 product/UX designer",
      timeline: "MVP 10 weeks",
      budget: "$50k-90k",
      documentNeeds: "Tech Spec",
    },
  },
];

const TEST_DATA = PRESETS[0].data;

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
  const [criticReport, setCriticReport] = useState<Record<string, unknown> | null>(null);
  const [clientEmail, setClientEmail] = useState("");
  const [clientName, setClientName] = useState("");
  const [deliveryResult, setDeliveryResult] = useState<{ pdfGenerated: boolean; emailSent: boolean } | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [meta, setMeta] = useState<{ costUsd: number; tokens: number } | null>(null);
  const [wasRevised, setWasRevised] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // ── Dynamic Context Layer (in-session) ───────────────────────────────────────
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [architectReport, setArchitectReport] = useState<Record<string, unknown> | null>(null);

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  // Run the Context Extractor on an agent output and return the materialized items.
  // Non-fatal by contract: any failure logs and returns [] so the pipeline continues.
  const runExtract = async (agentOutput: unknown, agentRole: AgentRole): Promise<ContextItem[]> => {
    if (!ENABLE_DCL) return [];
    try {
      const res = await fetch("/api/agents/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentOutput, agentRole, documentType: form.documentNeeds }),
      });
      const json = await res.json() as { data?: { suggested_context_items?: unknown[] } };
      const suggested = json?.data?.suggested_context_items;
      if (Array.isArray(suggested) && suggested.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return materialize(suggested as any, agentRole, new Date().toISOString());
      }
    } catch (e) {
      console.error("[dcl] extraction failed for", agentRole, e);
    }
    return [];
  };

  // Build the role-specific context package text to inject into an agent prompt.
  // Reads the given items snapshot (callers pass the current state) and never throws.
  const packageFor = (role: AgentRole, items: ContextItem[]): string | undefined => {
    if (!ENABLE_DCL) return undefined;
    try {
      const text = buildAndRender(baseContextFromIntake(form), items, role);
      return text || undefined;
    } catch (e) {
      console.error("[dcl] package build failed for", role, e);
      return undefined;
    }
  };

  // User override on a suggested context item (optional — auto-accept means the
  // pipeline never waits on this, but the user can still correct the engine).
  const setItemStatus = (id: string, status: ContextStatus) =>
    setContextItems(prev => prev.map(it => (it.id === id ? { ...it, status } : it)));
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

  // ── Async job helper (Writer / Reviser) ────────────────────────────────────
  // Writer and Reviser run on Sonnet via a Netlify Background Function (up to 15 min),
  // so they can produce a full-quality document without hitting the request timeout.
  // We start the job, then poll its status in Supabase until it finishes.
  const runJob = async (
    kind: "writer" | "revise" | "critic" | "research" | "architect",
    input: object,
    paymentTxHash?: string
  ): Promise<{ data: Record<string, unknown>; meta: Record<string, unknown> }> => {
    const startRes = await fetch("/api/generate/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, input, paymentTxHash }),
    });
    const startData = await startRes.json() as { jobId?: string; error?: string };
    if (!startRes.ok || !startData.jobId) throw new Error(startData.error ?? "Failed to start generation");

    const poll = async (jobId: string) => {
      const sRes = await fetch(`/api/generate/status?jobId=${jobId}`);
      const sData = await sRes.json() as { status?: string; output?: Record<string, unknown>; meta?: Record<string, unknown>; error?: string };
      if (!sRes.ok) throw new Error(sData.error ?? "Status check failed");
      return sData;
    };

    // Poll for up to 14 min (background function limit is 15 min)
    const deadline = Date.now() + 14 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      const sData = await poll(startData.jobId);
      if (sData.status === "done") return { data: sData.output ?? {}, meta: sData.meta ?? {} };
      if (sData.status === "error") throw new Error(sData.error ?? "Generation failed");
    }

    // Final check: background function may have just finished as the client timed out
    const finalCheck = await poll(startData.jobId).catch(() => null);
    if (finalCheck?.status === "done") return { data: finalCheck.output ?? {}, meta: finalCheck.meta ?? {} };

    throw new Error("Generation timed out after 14 min. The background worker may have hit an internal error — check Netlify function logs.");
  };



  // ── Step 1: Research ───────────────────────────────────────────────────────
  const runResearch = async () => {
    if (!form.projectName) { setError("Enter a project name to continue"); return; }
    setStatus("running"); setResearchResult(null); setSpec(null); setQaReport(null); setCriticReport(null); setError(""); setMeta(null); setWasRevised(false); setIsPaid(false);
    setContextItems([]); setArchitectReport(null);
    const timer = startTimer(s => setElapsed(s));
    try {
      const { data, meta } = await runJob("research", { intakeData: form });
      const secs = timer.stop(); setElapsed(secs);
      setResearchResult(data);
      setMeta({ costUsd: (meta.costUsd as number) ?? 0, tokens: ((meta.inputTokens as number) ?? 0) + ((meta.outputTokens as number) ?? 0) });
      // DCL: Context v0 (base) + items extracted from the research brief.
      if (ENABLE_DCL) {
        const baseItems = seedBaseContextItems(baseContextFromIntake(form), new Date().toISOString());
        const researchItems = await runExtract(data, "research");
        setContextItems([...baseItems, ...researchItems]);
      }
      setStatus("done");
    } catch (e) {
      timer.stop();
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setStatus("error");
    }
  };

  // ── Step 2: Writer ─────────────────────────────────────────────────────────
  const runWriter = async (paymentTxHash: string) => {
    setStatus("writing"); setError("");
    const timer = startTimer(s => setElapsed(s));
    try {
      // DCL: give the Writer a validated, role-specific context package.
      const contextPackage = packageFor("writer", contextItems);
      const { data, meta } = await runJob("writer", { intakeData: form, researchReport: researchResult, contextPackage }, paymentTxHash);
      timer.stop();
      setSpec(data as unknown as TechSpec);
      setMeta({ costUsd: (meta.costUsd as number) ?? 0, tokens: ((meta.inputTokens as number) ?? 0) + ((meta.outputTokens as number) ?? 0) });
      setWasRevised(false);
      // DCL: extract context from the draft for the review agents that follow.
      if (ENABLE_DCL) {
        const writerItems = await runExtract(data, "writer");
        if (writerItems.length > 0) setContextItems(prev => [...prev, ...writerItems]);
      }
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
      // Three independent reviewers run in parallel after the Writer:
      //   QA (edge SSE)            — quality / requirement coverage
      //   Critic (background job)  — adversarial credibility attack
      //   Implementation Architect — build-readiness (DCL-gated; new agent)
      // Each reviewer additive: if one fails, the others still drive the flow.
      const qaPackage = packageFor("qa", contextItems);
      const criticPackage = packageFor("critic", contextItems);
      const architectPackage = packageFor("implementation_architect", contextItems);

      const qaPromise = fetchSSE("/api/agents/qa", { techSpec: spec, researchReport: researchResult, documentType: form.documentNeeds, contextPackage: qaPackage });
      const criticPromise = runJob("critic", {
        techSpec: spec,
        researchReport: researchResult,
        intakeData: form,
        documentType: form.documentNeeds,
        targetAudience: form.targetAudience,
        contextPackage: criticPackage,
      }).catch((e) => {
        console.error("Critic failed:", e);
        return null;
      });
      const architectPromise = ENABLE_DCL
        ? runJob("architect", {
            techSpec: spec,
            researchReport: researchResult,
            intakeData: form,
            documentType: form.documentNeeds,
            contextPackage: architectPackage,
          }).catch((e) => {
            console.error("Architect failed:", e);
            return null;
          })
        : Promise.resolve(null);

      const [{ data, meta }, criticOut, architectOut] = await Promise.all([qaPromise, criticPromise, architectPromise]);
      timer.stop();

      setQaReport(data as unknown as QAReport);
      if (criticOut && criticOut.data) {
        setCriticReport(criticOut.data as Record<string, unknown>);
      }
      if (architectOut && architectOut.data) {
        setArchitectReport(architectOut.data as Record<string, unknown>);
      }
      setMeta({ costUsd: (meta.costUsd as number) ?? 0, tokens: ((meta.inputTokens as number) ?? 0) + ((meta.outputTokens as number) ?? 0) });

      // DCL: distill each reviewer's findings into context items for the Reviser.
      if (ENABLE_DCL) {
        const [qaItems, criticItems, architectItems] = await Promise.all([
          runExtract(data, "qa"),
          criticOut?.data ? runExtract(criticOut.data, "critic") : Promise.resolve([]),
          architectOut?.data ? runExtract(architectOut.data, "implementation_architect") : Promise.resolve([]),
        ]);
        const merged = [...qaItems, ...criticItems, ...architectItems];
        if (merged.length > 0) setContextItems(prev => [...prev, ...merged]);
      }
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
      // DCL: the Reviser gets a validated package (constraints + accepted findings)
      // plus the structured Critic and Implementation Architect reports.
      const contextPackage = packageFor("revise", contextItems);
      const { data, meta } = await runJob("revise", { techSpec: spec, qaReport, criticReport, architectReport, intakeData: form, documentType: form.documentNeeds, contextPackage });
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

  // Download the AntLab-styled PDF from the deliver route (server-side PDFShift
  // render). This replaces window.print() so the file is the branded document only —
  // never the browser preview / app chrome.
  const downloadPdf = async () => {
    if (!spec) return;
    setDownloading(true); setError("");
    try {
      const res = await fetch("/api/agents/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ techSpec: spec, projectName: form.projectName, returnPdf: true }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error("PDF generation failed: " + t.slice(0, 160));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${form.projectName.replace(/\s+/g, "-")}-AntLab-tech-spec.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      // Server-side PDF render unavailable (PDFSHIFT_API_KEY not set, out of credits,
      // etc.). Generate the branded PDF entirely in the browser instead — Download
      // always produces a real AntLab PDF file, with no external dependency.
      console.error("[download] server PDF unavailable, using browser-generated PDF:", e);
      try {
        const blob = pdfBlobFromSpec(spec as unknown as Parameters<typeof pdfBlobFromSpec>[0]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${form.projectName.replace(/\s+/g, "-")}-AntLab-tech-spec.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e2) {
        setError("PDF download failed: " + (e2 instanceof Error ? e2.message : String(e2)));
      }
    } finally {
      setDownloading(false);
    }
  };

  // ── Step 4: Deliver ────────────────────────────────────────────────────────
  const runDeliver = async () => {
    if (!clientEmail) { setError("Enter client email to deliver"); return; }
    setStatus("delivering"); setError("");
    const timer = startTimer(s => setElapsed(s));
    try {
      // Generate the branded PDF in the browser and send it along, so the email can
      // be attached even when the server PDFShift render is unavailable. The server
      // still prefers its own PDFShift render when it succeeds.
      let pdfBase64: string | undefined;
      try { pdfBase64 = pdfBase64FromSpec(spec as unknown as Parameters<typeof pdfBase64FromSpec>[0]); }
      catch (e) { console.error("[deliver] client PDF generation failed:", e); }

      const res = await fetch("/api/agents/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ techSpec: spec, clientEmail, clientName, projectName: form.projectName, pdfBase64 }),
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
    // The document is ready to send to the client only once it is final: either a
    // revision has been applied, or QA approved it (score >= 9). Delivery must NOT be
    // offered on an un-revised draft that QA flagged for revision, and it MUST remain
    // available after a revision (when qaReport is cleared). Persist through delivery.
    const documentReady = wasRevised || (qaReport !== null && qaReport.score >= 9);

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
            /* Only the document itself prints — every other card/panel/toolbar in
               the workspace is suppressed, so no app chrome can leak into the PDF. */
            .doc-wrap > :not(.doc-page) { display: none !important; }
            .doc-bar,.qa-panel,.delivery-panel,.dcl-panel { display: none !important; }
            .doc-wrap { max-width: none; margin: 0; padding: 0; }
            .doc-page { box-shadow: none; border-radius: 0; overflow: visible; }
            body { background: #fff !important; }
            .sec { break-inside: avoid; }
            table.spec, table.spec tr, .hl, pre.code { break-inside: avoid; }
            .body { padding-bottom: 28px; }
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
          table.spec { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 12.5px; table-layout: fixed; }
          table.spec th { background: #0055b3; color: #fff; text-align: left; padding: 9px 12px; font-weight: 600; word-break: break-word; overflow-wrap: anywhere; vertical-align: top; }
          table.spec td { padding: 9px 12px; border-bottom: 1px solid #e3e8f0; color: #2a2a3a; word-break: break-word; overflow-wrap: anywhere; white-space: normal; vertical-align: top; }
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
              <button onClick={downloadPdf} disabled={downloading} style={{ fontSize: 13, padding: "9px 22px", borderRadius: 50, background: "var(--accent)", color: "#fff", boxShadow: "0 4px 14px rgba(33,37,102,0.28)", border: "none", cursor: downloading ? "default" : "pointer", fontFamily: "inherit", fontWeight: 700 }}>{downloading ? "Generating PDF…" : "Download PDF"}</button>
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

              {/* Implementation Architect — build-readiness summary */}
              {architectReport && (architectReport.verdict as Record<string, unknown> | undefined) && (
                <div style={{ background: "var(--bg)", borderRadius: 10, padding: "12px 14px", marginBottom: 12, borderLeft: "3px solid #6d28d9" }}>
                  <p style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "#6d28d9", fontWeight: 700, marginBottom: 6 }}>
                    Implementation Architect — build readiness {typeof (architectReport.verdict as Record<string, unknown>).buildReadinessScore === "number" ? `${(architectReport.verdict as Record<string, unknown>).buildReadinessScore}/10` : ""}
                  </p>
                  <p style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.55 }}>{String((architectReport.verdict as Record<string, unknown>).summary ?? "")}</p>
                  {(architectReport.verdict as Record<string, unknown>).biggestBlocker ? (
                    <p style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.5, marginTop: 6 }}>Biggest blocker: {String((architectReport.verdict as Record<string, unknown>).biggestBlocker)}</p>
                  ) : null}
                </div>
              )}

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
                <button onClick={downloadPdf} disabled={downloading} style={{ width: "100%", padding: "14px 18px", borderRadius: 50, background: "var(--green)", color: "#fff", border: "none", cursor: downloading ? "default" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14, boxShadow: "0 4px 16px rgba(16,185,129,0.30)", marginBottom: 14 }}>
                  {downloading ? "Generating PDF…" : "Download PDF"}
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

            </div>
          )}

          {/* Send to client — standalone card, available once the document is FINAL
              (QA-approved or revised), independent of the QA panel so it survives the
              post-revision state where qaReport is cleared. */}
          {documentReady && (
            <div className="delivery-panel" style={{ ...card, padding: "20px 22px", marginBottom: 18 }}>
              {status === "delivered" && deliveryResult ? (
                <div style={{ background: "rgba(16, 185, 129, 0.08)", borderRadius: 10, padding: "14px 16px", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "var(--green)", marginBottom: 6 }}>Delivered</p>
                  <p style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.6 }}>
                    {deliveryResult.emailSent ? `Email sent to ${clientEmail}` : "Email delivery skipped (no RESEND_API_KEY configured)"}
                    {deliveryResult.pdfGenerated ? " · PDF generated via PDFShift" : " · Use Download PDF for the branded copy"}
                  </p>
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>
          )}

          {/* DCL: context layer feeding the Reviser */}
          {showQAResult && (
            <DclPanel items={contextItems} onSetStatus={setItemStatus} card={card} title="Dynamic Context — feeding the Reviser" form={form} previewRoles={["revise"]} />
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
              <button onClick={downloadPdf} disabled={downloading} style={{ padding: "12px 28px", borderRadius: 50, background: "var(--accent)", color: "#fff", border: "none", cursor: downloading ? "default" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14, boxShadow: "0 4px 16px rgba(33,37,102,0.28)", whiteSpace: "nowrap" }}>
                {downloading ? "Generating PDF…" : "Download PDF"}
              </button>
            </div>
          )}

          {/* Document */}
          <div className="doc-page">
            <div className="cover">
              <span className="badge">AntLab</span>
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
            <div className="foot">Prepared by AntLab — {spec.title} — Confidential</div>
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
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
            <h2 style={{ fontSize: 25, fontWeight: 800, color: "var(--bright)", letterSpacing: "-0.3px" }}>Intake form</h2>
            <select
              onChange={e => { const p = PRESETS.find(x => x.label === e.target.value); if (p) setForm(p.data); e.target.value = ""; }}
              defaultValue=""
              style={{ fontSize: 11, padding: "5px 14px", borderRadius: 50, background: "var(--card)", boxShadow: "var(--shadow-sm)", color: "var(--dim)", border: "1.5px solid rgba(15,18,64,0.10)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, appearance: "none", WebkitAppearance: "none" }}
            >
              <option value="" disabled>Load example</option>
              {PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
          </div>
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
            {status === "writing"
              ? elapsed < 30
                ? "Starting background generation — Sonnet 4.6 drafting the full technical specification..."
                : elapsed < 120
                ? "Generation in progress — Sonnet 4.6 is writing all 10 sections (~3-5 min total)..."
                : elapsed < 240
                ? `Almost there — large documents take 3-5 min. Running for ${Math.floor(elapsed / 60)}m ${elapsed % 60}s...`
                : `Still writing — complex Tech Specs can take up to 7 min. Please don't close the tab. (${Math.floor(elapsed / 60)}m ${elapsed % 60}s)`
              : "Analyzing project, market and competitors..."}
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
          {!isPaid && (
            <div style={{ ...card, padding: "20px 22px", marginBottom: 18, border: "1.5px solid rgba(15,18,64,0.06)" }}>
              <p style={{ fontSize: 10, letterSpacing: "3px", textTransform: "uppercase", color: "var(--accent)", marginBottom: 8, fontWeight: 700 }}>Step 2</p>
              <p style={{ fontSize: 17, fontWeight: 700, color: "var(--bright)", marginBottom: 4 }}>Generate full document</p>
              <p style={{ fontSize: 12.5, color: "var(--dim)", lineHeight: 1.5, marginBottom: 16 }}>Writer → QA → Revise → PDF. One-time payment of <strong>$1 USDC</strong> on Base Sepolia.</p>
              <PayAndGenerate
                disabled={!form.projectName}
                onPaid={(txHash) => { setIsPaid(true); void runWriter(txHash); }}
              />
            </div>
          )}

          {error && <div style={{ ...card, padding: "14px 16px", marginBottom: 16, color: "#c83838", fontSize: 13 }}>{error}</div>}

          <DclPanel items={contextItems} onSetStatus={setItemStatus} card={card} title="Dynamic Context — after Research" form={form} previewRoles={["writer"]} />

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {Object.entries(researchResult).map(([key, val]) => {
              const accent = key === "redFlags" ? "#c83838" : key === "opportunities" ? "var(--green)" : "var(--accent)";
              const renderVal = (v: unknown, depth = 0): React.ReactNode => {
                if (v === null || v === undefined) return null;
                if (typeof v === "string") return <span>{v}</span>;
                if (typeof v === "number" || typeof v === "boolean") return <span>{String(v)}</span>;
                if (Array.isArray(v)) {
                  if (v.length === 0) return null;
                  if (typeof v[0] === "string" || typeof v[0] === "number") {
                    return <ul style={{ margin: "4px 0 0 14px", padding: 0 }}>{(v as string[]).map((item, i) => <li key={i} style={{ marginBottom: 4 }}>{item}</li>)}</ul>;
                  }
                  return <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>{(v as unknown[]).map((item, i) => <div key={i} style={{ background: "var(--bg)", borderRadius: 8, padding: "10px 12px" }}>{renderVal(item, depth + 1)}</div>)}</div>;
                }
                if (typeof v === "object") {
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: depth === 0 ? 10 : 6 }}>
                      {Object.entries(v as Record<string, unknown>).map(([k, vv]) => (
                        <div key={k}>
                          <span style={{ fontSize: 10, letterSpacing: "1px", textTransform: "uppercase", color: "var(--dim)", fontWeight: 700 }}>{k.replace(/([A-Z])/g, " $1")}</span>
                          <div style={{ marginTop: 3 }}>{renderVal(vv, depth + 1)}</div>
                        </div>
                      ))}
                    </div>
                  );
                }
                return null;
              };
              return (
                <div key={key} style={{ ...card, overflow: "hidden" }}>
                  <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 9 }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent }} />
                    <span style={{ fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 700, color: accent }}>{key.replace(/([A-Z])/g, " $1")}</span>
                  </div>
                  <div style={{ padding: "0 18px 16px", fontSize: 13, color: "var(--text)", lineHeight: 1.7 }}>
                    {renderVal(val)}
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

// ── Dynamic Context Layer panel ────────────────────────────────────────────────
// Read-mostly view of the in-session context items, grouped by status. Auto-accept
// is the policy, so this never blocks the pipeline — but the user can still correct
// a flagged ("review required") item with Accept / Reject, or archive any item.
const TYPE_COLOR: Record<string, string> = {
  constraint: "#2563eb", decision: "#6d28d9", risk: "#dc2626", assumption: "#7c3aed",
  market_claim: "#d97706", security_issue: "#dc2626", legal_issue: "#dc2626",
  technical_gap: "#0f766e", source_requirement: "#0f766e", open_question: "#9333ea",
  review_finding: "#0891b2", formatting_issue: "#64748b", goal: "#2563eb",
  agent_instruction: "#475569",
};

function DclPanel({
  items,
  onSetStatus,
  card,
  title,
  form,
  previewRoles = [],
}: {
  items: ContextItem[];
  onSetStatus: (id: string, status: ContextStatus) => void;
  card: React.CSSProperties;
  title: string;
  form?: Record<string, string>;
  previewRoles?: AgentRole[];
}) {
  const [open, setOpen] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  if (!ENABLE_DCL || items.length === 0) return null;

  const visible = items.filter(i => i.status !== "archived");
  const autoAccepted = visible.filter(i => i.status === "auto_accepted" || i.status === "accepted");
  const reviewRequired = visible.filter(i => i.status === "review_required");
  const rejected = visible.filter(i => i.status === "rejected");

  const chip = (label: string, color: string) => (
    <span style={{ fontSize: 9, letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700, color, background: `${color}14`, padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap" }}>{label}</span>
  );

  const row = (it: ContextItem) => (
    <div key={it.id} style={{ background: "var(--bg)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
        {chip(it.type.replace(/_/g, " "), TYPE_COLOR[it.type]?.trim() || "#475569")}
        {chip(it.risk_level, it.risk_level === "critical" || it.risk_level === "high" ? "#dc2626" : it.risk_level === "medium" ? "#d97706" : "#64748b")}
        <span style={{ fontSize: 10.5, color: "var(--dim)" }}>via {it.source_agent} · conf {Math.round((it.confidence ?? 0) * 100)}%</span>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5 }}>{it.content}</p>
      {it.reason && <p style={{ fontSize: 11, color: "var(--dim)", lineHeight: 1.45, marginTop: 4 }}>{it.reason}</p>}
      {(it.status === "review_required" || it.status === "rejected") && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button onClick={() => onSetStatus(it.id, "accepted")} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 20, background: "var(--green)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Accept</button>
          {it.status !== "rejected" && (
            <button onClick={() => onSetStatus(it.id, "rejected")} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 20, background: "var(--card)", color: "#dc2626", border: "1.5px solid rgba(220,38,38,0.3)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Reject</button>
          )}
          <button onClick={() => onSetStatus(it.id, "archived")} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 20, background: "var(--card)", color: "var(--dim)", border: "1.5px solid rgba(15,18,64,0.1)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Archive</button>
        </div>
      )}
    </div>
  );

  const group = (label: string, color: string, list: ContextItem[]) => {
    if (list.length === 0) return null;
    return (
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 10, letterSpacing: "1.5px", textTransform: "uppercase", color, fontWeight: 700, marginBottom: 8 }}>{label} ({list.length})</p>
        {list.map(row)}
      </div>
    );
  };

  // Internal debug: the EXACT context-package text injected into each upcoming
  // agent prompt. Rendered with the real builder, behind a toggle, and the whole
  // panel carries class "dcl-panel" so it is excluded from the client PDF (print).
  const debugRoles = previewRoles.filter(Boolean);
  const packagesByRole = form
    ? debugRoles.map(r => ({ role: r, text: buildAndRender(baseContextFromIntake(form), items, r) }))
    : [];

  return (
    <div className="dcl-panel" style={{ ...card, padding: "16px 18px", marginBottom: 16, border: "1.5px solid rgba(109,40,217,0.18)" }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#6d28d9" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--bright)" }}>{title}</span>
        </span>
        <span style={{ fontSize: 11, color: "var(--dim)" }}>{visible.length} items · {reviewRequired.length} flagged{open ? " ▲" : " ▼"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 11, color: "var(--dim)", lineHeight: 1.5, marginBottom: 12 }}>
            Validated context passed forward to the next agents. High-impact items are flagged for review (never treated as fact); low-risk operational items are auto-accepted. This panel is internal — it is never included in the client PDF.
          </p>
          {group("Auto-accepted", "var(--green)", autoAccepted)}
          {group("Review required", "#d97706", reviewRequired)}
          {group("Rejected / Needs source", "#dc2626", rejected)}

          {packagesByRole.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <button onClick={() => setShowDebug(d => !d)} style={{ fontSize: 11, padding: "5px 12px", borderRadius: 20, background: "var(--bg)", color: "var(--dim)", border: "1.5px solid rgba(15,18,64,0.1)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                {showDebug ? "Hide" : "Show"} context package (debug)
              </button>
              {showDebug && packagesByRole.map(({ role, text }) => (
                <div key={role} style={{ marginTop: 10 }}>
                  <p style={{ fontSize: 10, letterSpacing: "1px", textTransform: "uppercase", color: "var(--accent)", fontWeight: 700, marginBottom: 4 }}>→ {role.replace(/_/g, " ")} prompt injection</p>
                  <pre style={{ background: "#0d1530", color: "#c8d4f0", padding: "12px 14px", borderRadius: 8, fontSize: 11, lineHeight: 1.5, overflowX: "auto", whiteSpace: "pre-wrap", fontFamily: "'Courier New', monospace" }}>{text || "(empty — nothing to inject)"}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
