// Non-streaming Research agent. Runs inside the Netlify Background Function
// (same runtime as Writer/Reviser/Critic) which has a 15-minute timeout —
// no edge-function timeout to worry about even with web search enabled.

import type { GenerationResult } from "./generate";
import { maybeMock } from "./mock";

const RESEARCH_MODEL = "claude-sonnet-4-6";
const PRICE_INPUT_PER_M = 3;
const PRICE_OUTPUT_PER_M = 15;

const SYSTEM_PROMPT = `You are a senior Web3 research analyst with web search. Analyze the client intake form and produce a research brief.

Use web search to VERIFY any market-size, TVL, competitor, pricing, or cost figure
before stating it. Every quantitative market claim MUST include a source URL in the
"sources" array. If you cannot find a source, state the figure as an explicit
estimate and mark it as unverified - never present an unverified number as fact.

Respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.
Keep the "sources" array to a maximum of 5 entries — include only the most important citations.
Keep all string values concise; do not write paragraphs where a sentence will do.

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

export interface ResearchInput {
  intakeData: Record<string, string>;
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens: number; output_tokens: number };
}

export async function generateResearch(apiKey: string, input: ResearchInput): Promise<GenerationResult> {
  const mock = maybeMock("research");
  if (mock) return mock;

  const { intakeData } = input;
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

  const abort = new AbortController();
  const timeoutId = setTimeout(() => abort.abort(), 10 * 60 * 1000); // 10 min hard limit

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-search-2025-03-05",
    },
    body: JSON.stringify({
      model: RESEARCH_MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    }),
    signal: abort.signal,
  }).finally(() => clearTimeout(timeoutId));

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error: ${res.status} ${errText}`);
  }

  const json = (await res.json()) as AnthropicResponse;
  const text = (json.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("");

  if (!text) throw new Error("Research returned no text — web search may have produced no output");

  const clean = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let data: unknown;
  try {
    data = JSON.parse(clean);
  } catch {
    // Attempt to recover a truncated JSON response (e.g. max_tokens cut-off mid-value).
    // Extract the largest {...} fragment, then close any unclosed brackets/braces in order.
    const start = clean.indexOf("{");
    if (start === -1) throw new Error("Failed to parse research response as JSON");
    let fragment = clean.slice(start);

    // Walk the fragment tracking open brackets so we can close them correctly.
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    for (const c of fragment) {
      if (esc) { esc = false; continue; }
      if (c === "\\" && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (c === "{") stack.push("}");
        else if (c === "[") stack.push("]");
        else if (c === "}" || c === "]") stack.pop();
      }
    }
    // If we ended mid-string, close it first.
    if (inStr) fragment += '"';
    fragment += stack.reverse().join("");

    try {
      data = JSON.parse(fragment);
    } catch {
      throw new Error("Failed to parse research response as JSON");
    }
  }

  const inputTokens = json.usage?.input_tokens ?? 0;
  const outputTokens = json.usage?.output_tokens ?? 0;

  return {
    data,
    meta: {
      agentName: "research",
      durationMs: Date.now() - startTime,
      inputTokens,
      outputTokens,
      costUsd: (inputTokens / 1_000_000) * PRICE_INPUT_PER_M + (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M,
    },
  };
}
