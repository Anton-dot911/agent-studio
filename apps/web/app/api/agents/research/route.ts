import { NextRequest } from "next/server";

export const runtime = "edge";
export const maxDuration = 120;

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a senior Web3 research analyst. Analyze the client intake form and respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

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

interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: { input_tokens: number; output_tokens: number } };
  delta?: { type?: string; text?: string; stop_reason?: string };
  usage?: { output_tokens: number };
  index?: number;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { projectId, intakeData } = body as { projectId: string; intakeData: Record<string, string> };

  if (!projectId || !intakeData?.projectName) {
    return new Response(JSON.stringify({ error: "projectId and intakeData.projectName are required" }), { status: 400 });
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

        const userMessage = `PROJECT INTAKE FORM:
Name: ${intakeData.projectName}
Concept: ${intakeData.concept}
Problem: ${intakeData.problem}
Audience: ${intakeData.targetAudience}
Blockchain: ${intakeData.blockchain}
Existing Code: ${intakeData.existingCode}
Competitors: ${intakeData.competitors}
Team: ${intakeData.teamInfo}
Timeline: ${intakeData.timeline}
Budget: ${intakeData.budget}
Document Needs: ${intakeData.documentNeeds}`;

        const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 3000,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
            stream: true,
          }),
        });

        if (!apiRes.ok || !apiRes.body) {
          const errText = await apiRes.text();
          throw new Error(`Anthropic API error: ${apiRes.status} ${errText}`);
        }

        // Pipe Anthropic stream → our SSE stream
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
                // Forward progress so the connection stays alive
                send({ type: "progress", len: fullText.length });
              }

              if (event.type === "message_delta" && event.usage) {
                outputTokens = event.usage.output_tokens;
              }
            }
          }
        }

        // Parse accumulated JSON
        const clean = fullText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
        let data;
        try { data = JSON.parse(clean); }
        catch { const m = clean.match(/\{[\s\S]*\}/); if (m) data = JSON.parse(m[0]); else throw new Error("Failed to parse response"); }

        send({
          type: "done",
          success: true,
          data,
          meta: {
            agentName: "research",
            durationMs: Date.now() - startTime,
            inputTokens,
            outputTokens,
            costUsd: (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
            toolCallsCount: 0,
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
