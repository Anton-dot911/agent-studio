import { NextRequest } from "next/server";

export const runtime = "edge";
export const maxDuration = 120;

// Upgraded to Sonnet 4.6 + native web search. Research now GROUNDS market claims
// in real sources instead of generating plausible-sounding numbers from memory.
// Every market-size / competitor / cost figure should carry a source URL so the
// Writer cannot invent unsupported numbers (the root cause of "$50B+" with no cite).
const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are a senior Web3 research analyst with web search. Analyze the client intake form and produce a research brief.

Use web search to VERIFY any market-size, TVL, competitor, pricing, or cost figure
before stating it. Every quantitative market claim MUST include a source URL in the
"sources" array. If you cannot find a source, state the figure as an explicit
estimate and mark it as unverified - never present an unverified number as fact.

Respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

Focus on what matters MOST for the requested document type:
- Tech Spec: technical architecture, stack choices, integration patterns
- Tokenomics: token economics, market comparables, distribution models, vesting norms
- DeFi Audit: attack vectors, known vulnerabilities in similar protocols, security patterns

{
  "projectSummary": "string",
  "problemAnalysis": { "coreProblem": "string", "severity": "high", "existingSolutions": ["string"], "gap": "string" },
  "marketContext": { "sector": "string", "tam": "string (with source or marked estimate)", "growthTrend": "string", "keyDrivers": ["string"] },
  "competitiveAnalysis": [{ "name": "string", "type": "string", "strengths": ["string"], "weaknesses": ["string"], "differentiationOpportunity": "string" }],
  "technicalLandscape": { "recommendedStack": "string", "recommendedBlockchain": "string", "blockchainRationale": "string", "keyLibraries": ["string"], "knownRisks": ["string"], "architectureNotes": "string" },
  "teamAssessment": { "size": 1, "capability": "string", "timelineFeasibility": "string", "recommendedMvpScope": "string", "skillGaps": ["string"] },
  "redFlags": ["string"],
  "opportunities": ["string"],
  "sources": [{ "claim": "string", "url": "string" }],
  "researchConfidence": "high",
  "notesForWriter": "string (explicitly note which claims are sourced vs estimated)"
}`;

interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: { input_tokens: number; output_tokens: number } };
  delta?: { type?: string; text?: string; stop_reason?: string };
  usage?: { output_tokens: number };
  content_block?: { type?: string };
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
Document Needs: ${intakeData.documentNeeds}

Research this project. Use web search to verify market figures and competitor facts. Return the JSON brief with sources.`;

        const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 4500,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
            // Native Anthropic web search tool - returns sources automatically.
            tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
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
        let searching = false;

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

              // Surface a "searching" signal so the UI shows progress during tool use.
              if (event.type === "content_block_start" && event.content_block?.type === "server_tool_use") {
                searching = true;
                send({ type: "progress", searching: true });
              }

              // Only accumulate the model's TEXT output (the JSON brief), not the
              // tool-use/result blocks.
              if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
                fullText += event.delta.text;
                send({ type: "progress", len: fullText.length, searching });
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
            toolCallsCount: searching ? 1 : 0,
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
