import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are a senior technical documentation reviewer specializing in Web3 and blockchain projects. You review Technical Specification documents for quality, accuracy, completeness, and client-readiness.

Respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

OUTPUT STRUCTURE:
{
  "score": number (1-10, where 10 is publication-ready),
  "status": "approved" | "minor_revisions" | "major_revisions",
  "criticalIssues": ["issue that makes document unusable or factually wrong"],
  "majorIssues": ["issue that significantly reduces document value"],
  "minorIssues": ["small improvement opportunity"],
  "humanChecklist": ["action item for human reviewer before delivery"],
  "summary": "2-3 sentence overall assessment of document quality"
}

SCORING GUIDE:
- 9-10: Approved. Ready to deliver.
- 7-8: Minor revisions. Good quality, small gaps.
- 5-6: Major revisions needed.
- 1-4: Critical problems.

WHAT TO CHECK:
1. All 10 sections present and substantive
2. Technical accuracy — library names, protocols, patterns correct?
3. Consistency — sections reference each other logically?
4. Specificity — concrete recommendations vs vague generalities
5. Security section — real attack vectors mentioned?
6. Cost Estimation — numbers realistic for the scope?
7. No hallucinated tech stacks or non-existent protocols
8. Smart Contract section — appropriate for the blockchain?

RULES:
- criticalIssues: genuinely blocking problems only. Empty [] if none.
- majorIssues: max 5 items.
- minorIssues: max 5 items.
- humanChecklist: 3-5 items a human should verify before sending to client.
- Be honest and specific. This is a paid deliverable.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { techSpec, researchReport } = body;

    if (!techSpec?.title || !researchReport) {
      return NextResponse.json({ error: "techSpec and researchReport are required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });
    const startTime = Date.now();

    const userMessage = `TECH SPEC TO REVIEW:
${JSON.stringify(techSpec, null, 2)}

ORIGINAL RESEARCH REPORT (for fact-checking):
${JSON.stringify(researchReport, null, 2)}

Review this document and return your QA report as JSON.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const durationMs = Date.now() - startTime;
    const raw = response.content.map((b) => b.type === "text" ? (b as { type: "text"; text: string }).text : "").join("").trim();
    const clean = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();

    let data;
    try {
      data = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) data = JSON.parse(match[0]);
      else throw new Error("Failed to parse QA response");
    }

    return NextResponse.json({
      success: true,
      data,
      meta: {
        agentName: "qa",
        durationMs,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsd: (response.usage.input_tokens / 1_000_000) * 3 + (response.usage.output_tokens / 1_000_000) * 15,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
