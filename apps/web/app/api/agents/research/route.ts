import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;

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
  try {
    const body = await req.json();
    const { projectId, intakeData } = body;

    if (!projectId || !intakeData?.projectName) {
      return NextResponse.json({ error: "projectId and intakeData.projectName are required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });
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
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const durationMs = Date.now() - startTime;
    const raw = response.content.filter((b) => b.type === "text").map((b) => (b as { type: "text"; text: string }).text).join("").trim();
    const clean = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();

    let data;
    try {
      data = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) data = JSON.parse(match[0]);
      else throw new Error("Failed to parse response");
    }

    return NextResponse.json({
      success: true,
      data,
      meta: {
        agentName: "research",
        durationMs,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsd: (response.usage.input_tokens / 1000000) * 3 + (response.usage.output_tokens / 1000000) * 15,
        toolCallsCount: 0,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
