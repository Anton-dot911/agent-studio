// packages/agents/src/writer-agent.ts

import Anthropic from "@anthropic-ai/sdk";
import {
  WriterAgentInput,
  WriterAgentOutput,
  TechSpec,
  calculateCostUsd,
} from "./types";
import { WRITER_SYSTEM_PROMPT } from "./prompts/writer";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4500;

export async function runWriterAgent(
  input: WriterAgentInput,
  apiKey: string
): Promise<WriterAgentOutput> {
  const startTime = Date.now();
  const client = new Anthropic({ apiKey });

  const { researchReport, documentType } = input.data;

  const userMessage = `DOCUMENT TYPE: ${documentType}

RESEARCH REPORT (JSON):
${JSON.stringify(researchReport, null, 2)}

Write the full Technical Specification now as the JSON object.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: WRITER_SYSTEM_PROMPT,
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

    const spec = parseTechSpec(rawText);

    return {
      success: true,
      data: spec,
      meta: {
        agentName: "writer",
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
        agentName: "writer",
        durationMs,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        toolCallsCount: 0,
      },
    };
  }
}

function parseTechSpec(raw: string): TechSpec {
  const clean = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(clean) as TechSpec;
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as TechSpec;
    throw new Error(`Failed to parse Writer Agent output. Raw: ${clean.slice(0, 200)}`);
  }
}
