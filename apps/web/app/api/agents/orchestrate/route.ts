import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";

export const maxDuration = 300;

const MODEL = "claude-sonnet-4-6";

// Inline helpers for PDF/email (same as deliver route)
type DocBlock =
  | { type: "para"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "highlight"; label: string; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; text: string };
interface DocSection { label: string; blocks: DocBlock[] }
interface TechSpec { title: string; subtitle: string; sections: DocSection[] }

const RESEARCH_PROMPT = `You are a senior Web3 research analyst. Analyze the client intake form and respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

{
  "projectSummary": "string",
  "problemAnalysis": { "coreProblem": "string", "severity": "high", "existingSolutions": ["string"], "gap": "string" },
  "marketContext": { "sector": "string", "tam": "string", "growthTrend": "string", "keyDrivers": ["string"] },
  "competitiveAnalysis": [{ "name": "string", "type": "string", "strengths": ["string"], "weaknesses": ["string"], "differentiationOpportunity": "string" }],
  "technicalLandscape": { "recommendedStack": "string", "recommendedBlockchain": "string", "blockchainRationale": "string", "keyLibraries": ["string"], "knownRisks": ["string"], "architectureNotes": "string" },
  "teamAssessment": { "size": 1, "capability": "string", "timelineFeasibility": "string", "recommendedMvpScope": "string", "skillGaps": ["string"] },
  "redFlags": ["string"],
  "opportunities": ["string"],
  "researchConfidence": "high",
  "notesForWriter": "string"
}`;

const WRITER_PROMPT = `You are a senior Web3 technical writer. Produce a complete Technical Specification document as JSON.

Respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

{
  "title": "string",
  "subtitle": "string",
  "sections": [{ "label": "string", "blocks": [{ "type": "para"|"bullets"|"highlight"|"table"|"code", ... }] }]
}

Produce EXACTLY these 10 sections: Executive Summary, Problem Statement, Solution Architecture, Smart Contract Design, Backend and API Specification, Frontend Integration, Security Considerations, Testing Strategy, Deployment Roadmap, Cost Estimation.

Rules: Each section 2-3 blocks. Paragraphs: 2-3 sentences. Bullets: 3-5 items. ONE highlight per section. Tables only in Smart Contract Design, Deployment Roadmap, Cost Estimation. Code max twice total.`;

const QA_PROMPT = `You are a technical documentation reviewer for Web3 projects.

Respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

{
  "score": number (1-10),
  "status": "approved" | "minor_revisions" | "major_revisions",
  "criticalIssues": ["string"],
  "majorIssues": ["string"],
  "minorIssues": ["string"],
  "humanChecklist": ["string"],
  "summary": "string"
}`;

function parseJson<T>(raw: string): T {
  const clean = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(clean) as T; } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error("JSON parse failed");
  }
}

function calcCost(inputTokens: number, outputTokens: number) {
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, intakeData, clientEmail, clientName } = body;

    if (!projectId || !intakeData?.projectName) {
      return NextResponse.json({ error: "projectId and intakeData.projectName are required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

    const client = new Anthropic({ apiKey });
    const pipelineStart = Date.now();
    let totalCost = 0;
    const steps: Array<{ agent: string; durationMs: number; costUsd: number }> = [];

    // ── Research ──────────────────────────────────────────────────────────────
    const t1 = Date.now();
    const r1 = await client.messages.create({
      model: MODEL, max_tokens: 4000, system: RESEARCH_PROMPT,
      messages: [{ role: "user", content: `PROJECT INTAKE FORM:\nName: ${intakeData.projectName}\nConcept: ${intakeData.concept}\nProblem: ${intakeData.problem}\nAudience: ${intakeData.targetAudience}\nBlockchain: ${intakeData.blockchain}\nExisting Code: ${intakeData.existingCode}\nCompetitors: ${intakeData.competitors}\nTeam: ${intakeData.teamInfo}\nTimeline: ${intakeData.timeline}\nBudget: ${intakeData.budget}\nDocument Needs: ${intakeData.documentNeeds}` }],
    });
    const researchReport = parseJson(r1.content.map(b => b.type === "text" ? (b as { type: "text"; text: string }).text : "").join("").trim());
    const c1 = calcCost(r1.usage.input_tokens, r1.usage.output_tokens);
    totalCost += c1;
    steps.push({ agent: "research", durationMs: Date.now() - t1, costUsd: c1 });

    // ── Writer ────────────────────────────────────────────────────────────────
    const t2 = Date.now();
    const r2 = await client.messages.create({
      model: MODEL, max_tokens: 4500, system: WRITER_PROMPT,
      messages: [{ role: "user", content: `INTAKE DATA:\nProject: ${intakeData.projectName}\nConcept: ${intakeData.concept}\nProblem: ${intakeData.problem}\nAudience: ${intakeData.targetAudience}\nBlockchain: ${intakeData.blockchain}\nExisting Code: ${intakeData.existingCode}\nCompetitors: ${intakeData.competitors}\nTeam: ${intakeData.teamInfo}\nTimeline: ${intakeData.timeline}\nBudget: ${intakeData.budget}\nDocument Needs: ${intakeData.documentNeeds}\n\nRESEARCH REPORT:\n${JSON.stringify(researchReport, null, 2)}\n\nWrite the full Technical Specification now as the JSON object.` }],
    });
    const techSpec = parseJson<TechSpec>(r2.content.map(b => b.type === "text" ? (b as { type: "text"; text: string }).text : "").join("").trim());
    const c2 = calcCost(r2.usage.input_tokens, r2.usage.output_tokens);
    totalCost += c2;
    steps.push({ agent: "writer", durationMs: Date.now() - t2, costUsd: c2 });

    // ── QA ────────────────────────────────────────────────────────────────────
    const t3 = Date.now();
    const r3 = await client.messages.create({
      model: MODEL, max_tokens: 2000, system: QA_PROMPT,
      messages: [{ role: "user", content: `TECH SPEC TO REVIEW:\n${JSON.stringify(techSpec, null, 2)}\n\nORIGINAL RESEARCH REPORT:\n${JSON.stringify(researchReport, null, 2)}\n\nReturn your QA report as JSON.` }],
    });
    const qaReport = parseJson(r3.content.map(b => b.type === "text" ? (b as { type: "text"; text: string }).text : "").join("").trim());
    const c3 = calcCost(r3.usage.input_tokens, r3.usage.output_tokens);
    totalCost += c3;
    steps.push({ agent: "qa", durationMs: Date.now() - t3, costUsd: c3 });

    // ── Delivery (optional) ───────────────────────────────────────────────────
    let delivery = { pdfGenerated: false, emailSent: false, emailId: undefined as string | undefined };

    if (clientEmail) {
      const t4 = Date.now();
      let pdfBuffer: ArrayBuffer | undefined;

      if (process.env.PDFSHIFT_API_KEY) {
        try {
          const pdfRes = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`api:${process.env.PDFSHIFT_API_KEY}`).toString("base64")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ source: buildDocumentHtml(techSpec), landscape: false, use_print_media: false }),
          });
          if (pdfRes.ok) { pdfBuffer = await pdfRes.arrayBuffer(); delivery.pdfGenerated = true; }
        } catch (e) { console.error("[orchestrate] PDFShift:", e); }
      }

      if (process.env.RESEND_API_KEY) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          const name = clientName || "there";
          const { data, error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || "Agent Studio <onboarding@resend.dev>",
            to: clientEmail,
            subject: `Your Tech Spec is Ready: ${intakeData.projectName}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;"><div style="background:#0055b3;padding:32px 40px;border-radius:8px 8px 0 0;"><h1 style="color:#fff;font-size:22px;margin:0;">Your document is ready</h1></div><div style="background:#f8f9fc;padding:32px 40px;border:1px solid #e3e8f0;border-radius:0 0 8px 8px;"><p style="font-size:15px;margin-bottom:16px;">Hi ${name},</p><p style="font-size:15px;margin-bottom:16px;">Your <strong>${intakeData.projectName}</strong> Technical Specification${pdfBuffer ? " is attached as a PDF" : " has been generated"}.</p></div></div>`,
            attachments: pdfBuffer ? [{ filename: `${intakeData.projectName.replace(/\s+/g, "-")}-tech-spec.pdf`, content: Buffer.from(pdfBuffer) }] : [],
          });
          if (!error && data?.id) { delivery.emailSent = true; delivery.emailId = data.id; }
        } catch (e) { console.error("[orchestrate] Resend:", e); }
      }

      steps.push({ agent: "delivery", durationMs: Date.now() - t4, costUsd: 0 });
    }

    return NextResponse.json({
      success: true,
      data: { projectId, researchReport, techSpec, qaReport, delivery, totalCostUsd: totalCost, totalDurationMs: Date.now() - pipelineStart, steps },
      meta: { agentName: "orchestrator", durationMs: Date.now() - pipelineStart, costUsd: totalCost },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderBlock(b: DocBlock): string {
  if (b.type === "para") return `<p style="font-size:13.5px;line-height:1.7;color:#2a2a3a;margin-bottom:12px;">${esc(b.text)}</p>`;
  if (b.type === "bullets") return `<ul style="margin:0 0 12px 18px;">${b.items.map(it => `<li style="font-size:13.5px;line-height:1.7;color:#2a2a3a;margin-bottom:5px;">${esc(it)}</li>`).join("")}</ul>`;
  if (b.type === "highlight") return `<div style="background:#eef4fc;border-left:4px solid #0055b3;border-radius:4px;padding:14px 16px;margin-bottom:14px;"><div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#0055b3;font-weight:700;margin-bottom:6px;">${esc(b.label)}</div><div style="font-size:13.5px;line-height:1.6;color:#1a2a44;">${esc(b.text)}</div></div>`;
  if (b.type === "table") return `<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12.5px;"><thead><tr>${b.headers.map(h => `<th style="background:#0055b3;color:#fff;text-align:left;padding:9px 12px;font-weight:600;">${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r, ri) => `<tr>${r.map(c => `<td style="padding:9px 12px;border-bottom:1px solid #e3e8f0;color:#2a2a3a;${ri%2===1?"background:#f6f9fd;":""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  if (b.type === "code") return `<pre style="background:#0d1530;color:#c8d4f0;padding:14px 16px;border-radius:6px;font-size:12px;line-height:1.6;margin-bottom:14px;font-family:monospace;white-space:pre-wrap;">${esc(b.text)}</pre>`;
  return "";
}

function buildDocumentHtml(spec: TechSpec): string {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(spec.title)}</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;color:#1a1a2e;}</style></head><body><div style="background:#0055b3;color:#fff;padding:56px 44px;"><div style="display:inline-block;font-size:11px;letter-spacing:2px;text-transform:uppercase;background:rgba(255,255,255,0.18);padding:6px 12px;border-radius:4px;margin-bottom:22px;">Agent Studio</div><h1 style="font-size:30px;font-weight:800;line-height:1.2;margin-bottom:12px;">${esc(spec.title)}</h1><p style="font-size:15px;opacity:0.92;line-height:1.5;">${esc(spec.subtitle)}</p></div><div style="padding:40px 44px;">${spec.sections.map(sec => `<div style="margin-bottom:34px;page-break-inside:avoid;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;"><div style="width:4px;height:20px;background:#0055b3;border-radius:2px;flex-shrink:0;"></div><h2 style="font-size:18px;font-weight:700;color:#0055b3;margin:0;">${esc(sec.label)}</h2></div>${sec.blocks.map(renderBlock).join("")}</div>`).join("")}</div><div style="padding:20px 44px;border-top:1px solid #e3e8f0;font-size:11px;color:#8a93a8;">Generated by Agent Studio — ${esc(spec.title)} — Confidential — ${today}</div></body></html>`;
}
