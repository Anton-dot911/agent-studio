import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;

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

Rules:
- Each section has 2 to 5 blocks. Mix block types appropriately.
- Use "highlight" for the single most important takeaway in a section.
- Use "table" for structured data (cost breakdowns, API endpoints, milestones, risk matrices).
- Use "code" for solidity snippets, function signatures, config, or schema.
- Use "bullets" for lists of features, risks, or steps.
- Write concrete, specific technical content grounded in the research. No filler.
- Cost Estimation must include a table with realistic USD ranges per workstream.
- Deployment Roadmap must include a table of phases with timelines.
- Keep total length professional but tight. This is a paid client deliverable.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, intakeData, researchReport } = body;

    if (!intakeData?.projectName || !researchReport) {
      return NextResponse.json({ error: "intakeData.projectName and researchReport are required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });
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

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
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
      else throw new Error("Failed to parse writer response");
    }

    return NextResponse.json({
      success: true,
      data,
      meta: {
        agentName: "writer",
        durationMs,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsd: (response.usage.input_tokens / 1000000) * 3 + (response.usage.output_tokens / 1000000) * 15,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
