// packages/agents/src/qa-agent.ts

import Anthropic from "@anthropic-ai/sdk";
import {
  QAAgentInput,
  QAAgentOutput,
  QAReport,
  calculateCostUsd,
} from "./types";
import { QA_SYSTEM_PROMPT } from "./prompts/qa";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2000;

export async function runQAAgent(
  input: QAAgentInput,
  apiKey: string
): Promise<QAAgentOutput> {
  const startTime = Date.now();
  const client = new Anthropic({ apiKey });

  const { techSpec, researchReport } = input.data;

  const userMessage = `TECH SPEC TO REVIEW:
${JSON.stringify(techSpec, null, 2)}

ORIGINAL RESEARCH REPORT (for fact-checking):
${JSON.stringify(researchReport, null, 2)}

Review this document and return your QA report as JSON.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: QA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const durationMs = Date.now() - startTime;
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    const rawText = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const report = parseQAReport(rawText);

    return {
      success: true,
      data: report,
      meta: {
        agentName: "qa",
        durationMs,
        inputTokens,
        outputTokens,
        costUsd: calculateCostUsd(inputTokens, outputTokens),
        toolCallsCount: 0,
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      meta: {
        agentName: "qa",
        durationMs,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        toolCallsCount: 0,
      },
    };
  }
}

function parseQAReport(raw: string): QAReport {
  const clean = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(clean) as QAReport;
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as QAReport;
    throw new Error(`Failed to parse QA Agent output. Raw: ${clean.slice(0, 200)}`);
  }
}
