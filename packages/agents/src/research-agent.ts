// packages/agents/src/research-agent.ts

import Anthropic from "@anthropic-ai/sdk";
import {
  ResearchAgentInput,
  ResearchAgentOutput,
  ResearchReport,
  calculateCostUsd,
} from "./types";
import { RESEARCH_SYSTEM_PROMPT } from "./prompts/research";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4000;

export async function runResearchAgent(
  input: ResearchAgentInput,
  apiKey: string,
  webSearchResults?: string  // optional — якщо Tavily є
): Promise<ResearchAgentOutput> {
  const startTime = Date.now();
  const client = new Anthropic({ apiKey });

  // Будуємо user message з intake форми
  const userMessage = buildUserMessage(input, webSearchResults);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const durationMs = Date.now() - startTime;
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    // Дістаємо текст
    const rawText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();

    // Парсимо JSON
    const report = parseResearchReport(rawText);

    return {
      success: true,
      data: report,
      meta: {
        agentName: "research",
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
        agentName: "research",
        durationMs,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        toolCallsCount: 0,
      },
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildUserMessage(
  input: ResearchAgentInput,
  webSearchResults?: string
): string {
  const { data: intake, memoryContext } = input;

  let message = `=== CLIENT INTAKE FORM ===

01. Project Name: ${intake.projectName}
02. Concept: ${intake.concept}
03. Problem: ${intake.problem}
04. Target Audience: ${intake.targetAudience}
05. Blockchain / Network: ${intake.blockchain}
06. Existing Code: ${intake.existingCode}
07. Competitors: ${intake.competitors}
08. Team: ${intake.teamInfo}
09. Timeline: ${intake.timeline}
10. Budget: ${intake.budget}
11. Document Needs: ${intake.documentNeeds}`;

  if (webSearchResults) {
    message += `\n\n=== WEB SEARCH RESULTS (use as additional context) ===\n${webSearchResults}`;
  }

  if (memoryContext) {
    message += `\n\n=== SIMILAR PAST PROJECTS (from memory) ===\n${memoryContext}`;
  }

  return message;
}

function parseResearchReport(raw: string): ResearchReport {
  // Очищаємо markdown fences якщо є
  const clean = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // Спроба прямого парсингу
  try {
    return JSON.parse(clean) as ResearchReport;
  } catch {
    // Витягуємо JSON блок
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as ResearchReport;
    }
    throw new Error(`Failed to parse Research Agent output. Raw: ${clean.slice(0, 200)}`);
  }
}
