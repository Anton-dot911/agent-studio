import "@anthropic-ai/sdk/shims/web";
import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "edge";
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-6";

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

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { projectId, intakeData } = body;

  if (!projectId || !intakeData?.projectName) {
    return new Response(JSON.stringify({ error: "projectId and intakeData.projectName are required" }), { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500 });
  }

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      const hb = setInterval(() =>
        controller.enqueue(encoder.encode(`: heartbeat\n\n`)), 5000);

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

        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        });

        const raw = response.content
          .map(b => b.type === "text" ? (b as { type: "text"; text: string }).text : "")
          .join("").trim();
        const clean = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();

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
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            costUsd: (response.usage.input_tokens / 1_000_000) * 3 + (response.usage.output_tokens / 1_000_000) * 15,
            toolCallsCount: 0,
          },
        });
      } catch (error) {
        send({ type: "error", success: false, error: error instanceof Error ? error.message : "Unknown error" });
      } finally {
        clearInterval(hb);
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
