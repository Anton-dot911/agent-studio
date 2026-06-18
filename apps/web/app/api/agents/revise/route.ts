import { NextRequest } from "next/server";

export const runtime = "edge";
export const maxDuration = 120;

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a senior technical editor. You receive a Technical Specification document and a QA report with issues. Produce a revised version that fixes all listed issues.

Respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

Keep the exact same structure as the input TechSpec:
{
  "title": "string",
  "subtitle": "string",
  "sections": [
    {
      "label": "string",
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

Rules:
- Keep all 10 sections with same labels
- Fix every critical issue — these are blocking
- Fix every major issue — these reduce quality
- Address minor issues where practical
- Address EVERY item in the Checklist — these are mandatory requirements the document must satisfy
- Same conciseness constraints as the original (2-3 blocks per section)
- Output must be complete and valid JSON`;

interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: { input_tokens: number; output_tokens: number } };
  delta?: { type?: string; text?: string };
  usage?: { output_tokens: number };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { techSpec, qaReport, intakeData, documentType } = body as {
    techSpec: { title: string };
    qaReport: {
      criticalIssues: string[];
      majorIssues: string[];
      minorIssues: string[];
      humanChecklist: string[];
      summary: string;
    };
    intakeData?: Record<string, string>;
    documentType?: string;
  };

  if (!techSpec?.title || !qaReport) {
    return new Response(JSON.stringify({ error: "techSpec and qaReport are required" }), { status: 400 });
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

        const issuesList = [
          ...qaReport.criticalIssues.map(i => `[CRITICAL] ${i}`),
          ...qaReport.majorIssues.map(i => `[MAJOR] ${i}`),
          ...qaReport.minorIssues.map(i => `[MINOR] ${i}`),
        ].join("\n");

        const userMessage = `DOCUMENT TYPE: ${documentType ?? intakeData?.documentNeeds ?? "Tech Spec"}

QA REPORT SUMMARY:
${qaReport.summary}

ISSUES TO FIX:
${issuesList || "No issues — minor polish only"}

CHECKLIST (every item below MUST be addressed in the revised document):
${qaReport.humanChecklist.join("\n")}

${intakeData ? `PROJECT CONTEXT:\nBlockchain: ${intakeData.blockchain}\nBudget: ${intakeData.budget}\nTimeline: ${intakeData.timeline}\n` : ""}

CURRENT TECH SPEC TO REVISE:
${JSON.stringify(techSpec, null, 2)}

Apply all fixes and return the improved Tech Spec as JSON.`;

        const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 8000,
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
        catch { const m = clean.match(/\{[\s\S]*\}/); if (m) data = JSON.parse(m[0]); else throw new Error("Failed to parse reviser response"); }

        send({
          type: "done",
          success: true,
          data,
          meta: {
            agentName: "revise",
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
