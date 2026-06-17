import { NextRequest } from "next/server";

export const runtime = "edge";
export const maxDuration = 300;

const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-6";

const RESEARCH_PROMPT = `You are a senior Web3 research analyst. Analyze the client intake form and respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

Focus your analysis on what matters most for the requested document type:
- Tech Spec: technical architecture, stack choices, integration patterns
- Tokenomics: token economics, market comparables, distribution models, vesting norms
- DeFi Audit: attack vectors, known vulnerabilities in similar protocols, security patterns

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

const WRITER_PROMPT = `You are a senior Web3 technical writer. Produce a complete document as JSON.

Respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

{
  "title": "string",
  "subtitle": "string",
  "sections": [{ "label": "string", "blocks": [{ "type": "para"|"bullets"|"highlight"|"table"|"code", ... }] }]
}

Produce EXACTLY 10 sections appropriate for the document type requested.
For Tech Spec: Executive Summary, Problem Statement, Solution Architecture, Smart Contract Design, Backend and API Specification, Frontend Integration, Security Considerations, Testing Strategy, Deployment Roadmap, Cost Estimation.
For Tokenomics: Executive Summary, Token Overview, Economic Model, Token Distribution, Vesting & Lock-up Schedule, Utility & Demand Drivers, Governance Framework, Market Comparables, Risk Analysis, Launch Roadmap & Cost Estimate.
For DeFi Audit: Executive Summary, Protocol Overview, Architecture & Smart Contracts, Attack Surface Analysis, Access Controls & Permissions, Economic Attack Vectors, Testing & Verification Strategy, Known Vulnerabilities Checklist, Remediation Roadmap, Audit Timeline & Cost Estimate.

Rules: Each section 2-3 blocks MAX. Paragraphs: 2-3 sentences. Bullets: 3-5 items. ONE highlight per section. Tables only where structurally useful (3-5 rows). Code max twice total. Prioritise finishing all 10 sections.`;

const QA_PROMPT = `You are a senior Web3 documentation reviewer. Review the document for quality, accuracy, completeness, and client-readiness.

Respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

{
  "score": number (1-10, where 10 is publication-ready),
  "status": "approved" | "minor_revisions" | "major_revisions",
  "criticalIssues": ["issue that makes document unusable or factually wrong"],
  "majorIssues": ["issue that significantly reduces document value"],
  "minorIssues": ["small improvement opportunity"],
  "humanChecklist": ["action item for human reviewer before delivery"],
  "summary": "2-3 sentence overall assessment"
}

Rules: criticalIssues — blocking only, empty [] if none. majorIssues max 5. minorIssues max 5. humanChecklist 3-5 items. Be honest and specific.`;

interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: { input_tokens: number; output_tokens: number } };
  delta?: { type?: string; text?: string };
  usage?: { output_tokens: number };
}

function parseJson<T>(raw: string): T {
  const clean = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(clean) as T; }
  catch { const m = clean.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]) as T; throw new Error("JSON parse failed"); }
}

async function streamAgent(
  apiKey: string,
  model: string,
  maxTokens: number,
  system: string,
  userMessage: string,
  stepName: string,
  send: (data: object) => void
): Promise<{ text: string; inputTokens: number; outputTokens: number; durationMs: number }> {
  const startTime = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: userMessage }], stream: true }),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text();
    throw new Error(`Anthropic API error (${stepName}): ${res.status} ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", fullText = "", inputTokens = 0, outputTokens = 0;

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
        if (!json || json === "[DONE]") continue;
        const event = JSON.parse(json) as AnthropicStreamEvent;
        if (event.type === "message_start" && event.message?.usage) inputTokens = event.message.usage.input_tokens;
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
          fullText += event.delta.text;
          send({ type: "progress", step: stepName, len: fullText.length });
        }
        if (event.type === "message_delta" && event.usage) outputTokens = event.usage.output_tokens;
      }
    }
  }

  return { text: fullText, inputTokens, outputTokens, durationMs: Date.now() - startTime };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { projectId, intakeData, clientEmail, clientName } = body as {
    projectId: string;
    intakeData: Record<string, string>;
    clientEmail?: string;
    clientName?: string;
  };

  if (!projectId || !intakeData?.projectName) {
    return new Response(JSON.stringify({ error: "projectId and intakeData.projectName are required" }), { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        const pipelineStart = Date.now();
        const steps: Array<{ agent: string; durationMs: number; costUsd: number; inputTokens: number; outputTokens: number }> = [];

        const haikuCost = (i: number, o: number) => (i / 1_000_000) * 0.25 + (o / 1_000_000) * 1.25;
        const sonnetCost = (i: number, o: number) => (i / 1_000_000) * 3 + (o / 1_000_000) * 15;

        const intakeText = `Name: ${intakeData.projectName}
Concept: ${intakeData.concept}
Problem: ${intakeData.problem}
Audience: ${intakeData.targetAudience}
Blockchain: ${intakeData.blockchain}
Existing Code: ${intakeData.existingCode}
Competitors: ${intakeData.competitors}
Team: ${intakeData.teamInfo}
Timeline: ${intakeData.timeline}
Budget: ${intakeData.budget}
Document Type: ${intakeData.documentNeeds}`;

        // ── Research ────────────────────────────────────────────────────────
        const r1 = await streamAgent(apiKey, HAIKU, 3500, RESEARCH_PROMPT, `PROJECT INTAKE FORM:\n${intakeText}`, "research", send);
        const researchReport = parseJson(r1.text);
        const c1 = haikuCost(r1.inputTokens, r1.outputTokens);
        steps.push({ agent: "research", durationMs: r1.durationMs, costUsd: c1, inputTokens: r1.inputTokens, outputTokens: r1.outputTokens });
        send({ type: "research_done", data: researchReport, meta: { durationMs: r1.durationMs, costUsd: c1 } });

        // ── Writer ──────────────────────────────────────────────────────────
        const r2 = await streamAgent(
          apiKey, HAIKU, 5500, WRITER_PROMPT,
          `INTAKE DATA:\n${intakeText}\n\nRESEARCH REPORT (JSON):\n${JSON.stringify(researchReport, null, 2)}\n\nWrite the full document now as the JSON object.`,
          "writer", send
        );
        const techSpec = parseJson(r2.text);
        const c2 = haikuCost(r2.inputTokens, r2.outputTokens);
        steps.push({ agent: "writer", durationMs: r2.durationMs, costUsd: c2, inputTokens: r2.inputTokens, outputTokens: r2.outputTokens });
        send({ type: "writer_done", data: techSpec, meta: { durationMs: r2.durationMs, costUsd: c2 } });

        // ── QA ──────────────────────────────────────────────────────────────
        const r3 = await streamAgent(
          apiKey, SONNET, 1500, QA_PROMPT,
          `DOCUMENT TO REVIEW:\n${JSON.stringify(techSpec, null, 2)}\n\nORIGINAL RESEARCH REPORT:\n${JSON.stringify(researchReport, null, 2)}\n\nReturn your QA report as JSON.`,
          "qa", send
        );
        const qaReport = parseJson(r3.text);
        const c3 = sonnetCost(r3.inputTokens, r3.outputTokens);
        steps.push({ agent: "qa", durationMs: r3.durationMs, costUsd: c3, inputTokens: r3.inputTokens, outputTokens: r3.outputTokens });
        send({ type: "qa_done", data: qaReport, meta: { durationMs: r3.durationMs, costUsd: c3 } });

        // ── Delivery (optional) ─────────────────────────────────────────────
        let delivery = { emailSent: false, emailId: undefined as string | undefined };
        if (clientEmail && process.env.RESEND_API_KEY) {
          const t4 = Date.now();
          try {
            const emailRes = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: process.env.RESEND_FROM_EMAIL || "Agent Studio <onboarding@resend.dev>",
                to: clientEmail,
                subject: `Your document is ready: ${intakeData.projectName}`,
                html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;"><div style="background:#0055b3;padding:32px 40px;border-radius:8px 8px 0 0;"><h1 style="color:#fff;font-size:22px;margin:0;">Your document is ready</h1></div><div style="background:#f8f9fc;padding:32px 40px;border:1px solid #e3e8f0;border-radius:0 0 8px 8px;"><p style="font-size:15px;margin-bottom:16px;">Hi ${clientName || "there"},</p><p style="font-size:15px;margin-bottom:16px;">Your <strong>${intakeData.projectName}</strong> ${intakeData.documentNeeds || "document"} has been generated by Agent Studio.</p><p style="font-size:13px;color:#888;">QA Score: ${(qaReport as { score?: number }).score ?? "—"}/10</p></div></div>`,
              }),
            });
            const emailData = await emailRes.json() as { id?: string };
            if (emailRes.ok && emailData.id) { delivery.emailSent = true; delivery.emailId = emailData.id; }
          } catch { /* email failure is non-blocking */ }
          steps.push({ agent: "delivery", durationMs: Date.now() - t4, costUsd: 0, inputTokens: 0, outputTokens: 0 });
          send({ type: "delivery_done", data: delivery });
        }

        const totalCost = steps.reduce((s, step) => s + step.costUsd, 0);
        send({
          type: "done",
          success: true,
          data: { projectId, researchReport, techSpec, qaReport, delivery, totalCostUsd: totalCost, totalDurationMs: Date.now() - pipelineStart, steps },
          meta: { agentName: "orchestrator", durationMs: Date.now() - pipelineStart, costUsd: totalCost },
        });
      } catch (error) {
        send({ type: "error", success: false, error: error instanceof Error ? error.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
