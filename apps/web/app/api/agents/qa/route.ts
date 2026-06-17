import { NextRequest } from "next/server";

export const runtime = "edge";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

const OUTPUT_STRUCTURE = `
Respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

OUTPUT STRUCTURE:
{
  "score": number (1-10, where 10 is publication-ready),
  "status": "approved" | "minor_revisions" | "major_revisions",
  "criticalIssues": ["issue that makes document unusable or factually wrong"],
  "majorIssues": ["issue that significantly reduces document value"],
  "minorIssues": ["small improvement opportunity"],
  "humanChecklist": ["specific action item the writer must address in the revised document"],
  "summary": "2-3 sentence overall assessment of document quality"
}

SCORING GUIDE:
- 9-10: Approved. Ready to deliver.
- 7-8: Minor revisions. Good quality, small gaps.
- 5-6: Major revisions needed.
- 1-4: Critical problems.

RULES:
- criticalIssues: genuinely blocking problems only. Empty [] if none.
- majorIssues: max 5 items.
- minorIssues: max 5 items.
- humanChecklist: 3-5 concrete items the writer must fix or add before the document is client-ready.
- Be honest and specific. This is a paid deliverable.`;

const TECH_SPEC_QA = `You are a senior technical documentation reviewer specializing in Web3 and blockchain projects. You review Technical Specification documents for quality, accuracy, completeness, and client-readiness.
${OUTPUT_STRUCTURE}

WHAT TO CHECK:
1. All 10 sections present and substantive
2. Technical accuracy — library names, protocols, patterns correct?
3. Consistency — sections reference each other logically?
4. Specificity — concrete recommendations vs vague generalities
5. Security section — real attack vectors mentioned?
6. Cost Estimation — numbers realistic for the scope?
7. No hallucinated tech stacks or non-existent protocols
8. Smart Contract section — appropriate for the blockchain?`;

const TOKENOMICS_QA = `You are a senior tokenomics reviewer and crypto economist. You review Tokenomics documents for economic soundness, accuracy, completeness, and client-readiness.
${OUTPUT_STRUCTURE}

WHAT TO CHECK:
1. All 10 sections present and substantive
2. Token distribution — percentages add up to 100%? Allocations realistic?
3. Vesting schedules — industry-standard? Prevent dump risk?
4. Economic model — supply/demand drivers credible?
5. Utility — genuine use cases or fabricated demand?
6. Governance — voting mechanism described clearly?
7. Market comparables — accurate data on cited projects?
8. Risk analysis — regulatory, liquidity, and concentration risks addressed?
9. Launch roadmap — timeline feasible for the team size and budget?
10. No invented tokenomics mechanisms or non-existent DeFi primitives`;

const DEFI_AUDIT_QA = `You are a senior smart contract security auditor. You review DeFi Audit Preparation documents for technical accuracy, completeness of threat modelling, and audit-readiness.
${OUTPUT_STRUCTURE}

WHAT TO CHECK:
1. All 10 sections present and substantive
2. Attack surface — reentrancy, flash loans, oracle manipulation, access control issues listed?
3. Architecture — contract relationships and trust assumptions correctly described?
4. Access controls — admin keys, multisig, timelocks mentioned where relevant?
5. Economic attack vectors — price manipulation, MEV, sandwich attacks considered?
6. Testing strategy — unit tests, fuzz testing, formal verification referenced?
7. Known vulnerabilities — SWC registry or common DeFi exploits referenced accurately?
8. Remediation roadmap — concrete fixes, not vague suggestions?
9. Audit cost & timeline — realistic for the codebase size?
10. No fabricated security tools or non-existent audit firms`;

function getQAPrompt(documentType: string): string {
  const t = documentType.toLowerCase();
  if (t.includes("tokenomics") || t.includes("token")) return TOKENOMICS_QA;
  if (t.includes("audit") || t.includes("defi") || t.includes("security")) return DEFI_AUDIT_QA;
  return TECH_SPEC_QA;
}

interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: { input_tokens: number; output_tokens: number } };
  delta?: { type?: string; text?: string };
  usage?: { output_tokens: number };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { techSpec, researchReport, documentType } = body as {
    techSpec: { title: string };
    researchReport: unknown;
    documentType?: string;
  };

  if (!techSpec?.title || !researchReport) {
    return new Response(JSON.stringify({ error: "techSpec and researchReport are required" }), { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500 });
  }

  const encoder = new TextEncoder();
  const systemPrompt = getQAPrompt(documentType ?? "tech spec");

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        const startTime = Date.now();

        const userMessage = `DOCUMENT TO REVIEW:
${JSON.stringify(techSpec, null, 2)}

ORIGINAL RESEARCH REPORT (for fact-checking):
${JSON.stringify(researchReport, null, 2)}

Review this document and return your QA report as JSON.`;

        const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 1500,
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
        catch { const m = clean.match(/\{[\s\S]*\}/); if (m) data = JSON.parse(m[0]); else throw new Error("Failed to parse QA response"); }

        send({
          type: "done",
          success: true,
          data,
          meta: {
            agentName: "qa",
            durationMs: Date.now() - startTime,
            inputTokens,
            outputTokens,
            costUsd: (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
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
