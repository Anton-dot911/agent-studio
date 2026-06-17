import { NextRequest } from "next/server";

export const runtime = "edge";
export const maxDuration = 120;

const MODEL = "claude-haiku-4-5-20251001";

const OUTPUT_STRUCTURE = `
Respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

Structure:
{
  "title": "string (e.g. ProjectName Technical Specification)",
  "subtitle": "string (one line, what this document covers)",
  "sections": [
    {
      "label": "string (section name)",
      "blocks": [
        { "type": "para", "text": "string" },
        { "type": "bullets", "items": ["string"] },
        { "type": "highlight", "label": "string", "text": "string" },
        { "type": "table", "headers": ["string"], "rows": [["string"]] },
        { "type": "code", "text": "string" }
      ]
    }
  ]
}

Rules (STRICT):
- Each section has 2 to 3 blocks MAX. Be concise and dense.
- Paragraphs: 2 to 3 sentences each. No filler, no repetition.
- Bullets: 3 to 5 short items, one line each.
- Use exactly ONE "highlight" per section for the key takeaway.
- Use "table" only where specified below. Keep tables to 3 to 5 rows.
- Use "code" only once or twice total, short snippets (under 12 lines).
- Write concrete content grounded in the research. This is a paid client deliverable.
- Prioritise finishing all 10 sections over depth in any one.`;

const TECH_SPEC_PROMPT = `You are a senior Web3 technical writer producing a complete Technical Specification document.
${OUTPUT_STRUCTURE}

Produce EXACTLY these 10 sections in this order:
1. Executive Summary
2. Problem Statement
3. Solution Architecture
4. Smart Contract Design
5. Backend and API Specification
6. Frontend Integration
7. Security Considerations
8. Testing Strategy
9. Deployment Roadmap
10. Cost Estimation

Use "table" only in: Smart Contract Design (functions), Deployment Roadmap (phases + timeline), Cost Estimation (USD ranges per workstream).`;

const TOKENOMICS_PROMPT = `You are a senior Web3 tokenomics analyst producing a complete Tokenomics document.
${OUTPUT_STRUCTURE}

Produce EXACTLY these 10 sections in this order:
1. Executive Summary
2. Token Overview
3. Economic Model
4. Token Distribution
5. Vesting & Lock-up Schedule
6. Utility & Demand Drivers
7. Governance Framework
8. Market Comparables
9. Risk Analysis
10. Launch Roadmap & Cost Estimate

Use "table" only in: Token Distribution (category + % + amount), Vesting & Lock-up Schedule (stakeholder + cliff + vesting period), Launch Roadmap & Cost Estimate (phase + timeline + budget).`;

const DEFI_AUDIT_PROMPT = `You are a senior Web3 security researcher producing a DeFi Audit Preparation document.
${OUTPUT_STRUCTURE}

Produce EXACTLY these 10 sections in this order:
1. Executive Summary
2. Protocol Overview
3. Architecture & Smart Contracts
4. Attack Surface Analysis
5. Access Controls & Permissions
6. Economic Attack Vectors
7. Testing & Verification Strategy
8. Known Vulnerabilities Checklist
9. Remediation Roadmap
10. Audit Timeline & Cost Estimate

Use "table" only in: Architecture & Smart Contracts (contract name + purpose + risk level), Known Vulnerabilities Checklist (vulnerability + severity + status), Audit Timeline & Cost Estimate (phase + duration + cost range).
Use "code" for one representative function signature or interface that illustrates the main risk area.`;

function getSystemPrompt(documentType: string): string {
  const t = documentType.toLowerCase();
  if (t.includes("tokenomics") || t.includes("token")) return TOKENOMICS_PROMPT;
  if (t.includes("audit") || t.includes("defi") || t.includes("security")) return DEFI_AUDIT_PROMPT;
  return TECH_SPEC_PROMPT;
}

interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: { input_tokens: number; output_tokens: number } };
  delta?: { type?: string; text?: string };
  usage?: { output_tokens: number };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { intakeData, researchReport, checklistItems } = body as {
    intakeData: Record<string, string>;
    researchReport: unknown;
    checklistItems?: string[];
  };

  if (!intakeData?.projectName || !researchReport) {
    return new Response(JSON.stringify({ error: "intakeData.projectName and researchReport are required" }), { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500 });
  }

  const encoder = new TextEncoder();
  const systemPrompt = getSystemPrompt(intakeData.documentNeeds ?? "tech spec");

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        const startTime = Date.now();

        const userMessage = `INTAKE DATA:
Project: ${intakeData.projectName}
Concept: ${intakeData.concept}
Problem: ${intakeData.problem}
Audience: ${intakeData.targetAudience}
Blockchain: ${intakeData.blockchain}
Existing Code: ${intakeData.existingCode}
Competitors: ${intakeData.competitors}
Team: ${intakeData.teamInfo}
Timeline: ${intakeData.timeline}
Budget: ${intakeData.budget}
Document Type: ${intakeData.documentNeeds}

RESEARCH REPORT (JSON):
${JSON.stringify(researchReport, null, 2)}
${checklistItems && checklistItems.length > 0 ? `
REVISION CHECKLIST (every item below MUST be addressed in the document):
${checklistItems.map((item, i) => `${i + 1}. ${item}`).join("\n")}
` : ""}
Write the full document now as the JSON object.`;

        const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 5500,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
            stream: true,
          }),
        });

        if (!apiRes.ok || !apiRes.body) {
          const errText = await apiRes.text();
          throw new Error(`Anthropic API error: ${apiRes.status} ${errText}`);
        }

        const reader = apiRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let fullText = "";
        let inputTokens = 0;
        let outputTokens = 0;

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

              if (event.type === "message_start" && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens;
              }

              if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
                fullText += event.delta.text;
                send({ type: "progress", len: fullText.length });
              }

              if (event.type === "message_delta" && event.usage) {
                outputTokens = event.usage.output_tokens;
              }
            }
          }
        }

        const clean = fullText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
        let data;
        try { data = JSON.parse(clean); }
        catch { const m = clean.match(/\{[\s\S]*\}/); if (m) data = JSON.parse(m[0]); else throw new Error("Failed to parse writer response"); }

        send({
          type: "done",
          success: true,
          data,
          meta: {
            agentName: "writer",
            durationMs: Date.now() - startTime,
            inputTokens,
            outputTokens,
            costUsd: (inputTokens / 1_000_000) * 0.25 + (outputTokens / 1_000_000) * 1.25,
          },
        });
      } catch (error) {
        const send2 = (data: object) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        send2({ type: "error", success: false, error: error instanceof Error ? error.message : "Unknown error" });
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
