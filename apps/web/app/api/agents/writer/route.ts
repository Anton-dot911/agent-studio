import { NextRequest } from "next/server";

export const runtime = "edge";
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are a senior Web3 technical writer. You receive a research report and intake data for a blockchain project, and you produce a complete, professional Technical Specification document.

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

Rules (STRICT - you must finish within a tight time budget):
- Each section has 2 to 3 blocks MAX. Be concise and dense.
- Paragraphs: 2 to 3 sentences each. No filler, no repetition.
- Bullets: 3 to 5 short items, one line each.
- Use exactly ONE "highlight" per section for the key takeaway.
- Use "table" only in Smart Contract Design, Deployment Roadmap (phases + timeline) and Cost Estimation (USD ranges per workstream). Keep tables to 3 to 5 rows.
- Use "code" only once or twice total, short snippets (under 12 lines).
- Write concrete technical content grounded in the research. This is a paid client deliverable, so quality over volume.
- Total output must stay compact. Prioritise finishing all 10 sections over depth in any one.`;

interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: { input_tokens: number; output_tokens: number } };
  delta?: { type?: string; text?: string };
  usage?: { output_tokens: number };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { intakeData, researchReport } = body as { intakeData: Record<string, string>; researchReport: unknown };

  if (!intakeData?.projectName || !researchReport) {
    return new Response(JSON.stringify({ error: "intakeData.projectName and researchReport are required" }), { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500 });
  }

  const encoder = new TextEncoder();

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
Document Needs: ${intakeData.documentNeeds}

RESEARCH REPORT (JSON):
${JSON.stringify(researchReport, null, 2)}

Write the full Technical Specification now as the JSON object.`;

        const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 2000,
            system: SYSTEM_PROMPT,
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
