// Context Extractor agent.
//
// After every agent run, this analyses the agent output and extracts reusable
// Context Items for the Dynamic Context Layer. It does NOT summarise the whole
// output — only the parts that help future agents produce better results.
//
// Runs on Haiku 4.5: structured extraction is well within Haiku's capability and
// keeping it cheap/fast matters because it runs after every pipeline stage.

import type { AgentRole, SuggestedContextItem } from "../dcl/types";

export const EXTRACTOR_MODEL = "claude-haiku-4-5";

// Haiku 4.5 pricing per million tokens.
const PRICE_INPUT_PER_M = 1;
const PRICE_OUTPUT_PER_M = 5;

const SYSTEM_PROMPT = `You are the Context Extractor for Agent Studio.

Your task is to analyze an agent output and extract reusable context items that may help future agents produce better results.

Do not summarize the whole output.
Extract only context that is useful for future execution.

Classify each item by:
- type
- content
- risk_level
- confidence
- recommended_status
- applies_to
- reason

Allowed type values: goal, constraint, decision, risk, assumption, open_question, technical_gap, market_claim, security_issue, legal_issue, formatting_issue, source_requirement, review_finding, agent_instruction.
Allowed risk_level values: low, medium, high, critical.
Allowed recommended_status values: auto_accepted, review_required, rejected_or_needs_source.
Allowed applies_to values: research, writer, qa, critic, implementation_architect, revise, final_qa.

Auto-accept only low-risk operational facts, structure notes, formatting issues, missing sections, technical gaps, source requirements, or repeated mistakes.

Require review for strategic decisions, MVP scope boundaries, budget assumptions, market claims, legal risks, security risks, architecture decisions, critical constraints, contradictions, or high-impact recommendations.

Mark as rejected_or_needs_source if the item is unsupported, speculative, contradictory, or likely hallucinated.

Extract at most 12 items. Prefer the highest-signal items. Keep each "content" to one or two sentences.

Return ONLY valid JSON. No markdown, no code fences. Start with { and end with }.

{
  "suggested_context_items": [
    {
      "type": "technical_gap",
      "content": "The document lacks concrete API request/response examples.",
      "risk_level": "medium",
      "confidence": 0.9,
      "recommended_status": "auto_accepted",
      "applies_to": ["implementation_architect", "revise", "final_qa"],
      "reason": "This is a concrete missing implementation detail."
    }
  ]
}`;

export interface ExtractorInput {
  agentOutput: unknown;
  agentRole: AgentRole;
  documentType?: string;
}

export interface ExtractorResult {
  data: { suggested_context_items: SuggestedContextItem[] };
  meta: {
    agentName: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens: number; output_tokens: number };
}

// Robust parse with stack-based truncation repair (same approach as research.ts):
// close any brackets the model left open if max_tokens cut the JSON short.
function parseSuggestions(raw: string): { suggested_context_items: SuggestedContextItem[] } {
  const clean = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  const tryParse = (s: string) => JSON.parse(s) as { suggested_context_items?: SuggestedContextItem[] };

  let parsed: { suggested_context_items?: SuggestedContextItem[] } | null = null;
  try {
    parsed = tryParse(clean);
  } catch {
    const start = clean.indexOf("{");
    if (start !== -1) {
      let fragment = clean.slice(start);
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
      if (inStr) fragment += '"';
      fragment += stack.reverse().join("");
      try { parsed = tryParse(fragment); } catch { parsed = null; }
    }
  }

  if (!parsed || !Array.isArray(parsed.suggested_context_items)) {
    // Invalid extractor output is non-fatal: return nothing rather than crashing the
    // pipeline. The caller logs this as a failed extraction.
    return { suggested_context_items: [] };
  }
  return { suggested_context_items: parsed.suggested_context_items };
}

export async function generateExtractor(apiKey: string, input: ExtractorInput): Promise<ExtractorResult> {
  const { agentOutput, agentRole, documentType } = input;
  const startTime = Date.now();

  const serialized = typeof agentOutput === "string" ? agentOutput : JSON.stringify(agentOutput, null, 2);

  // Empty output → nothing to extract. Skip the model call entirely.
  if (!serialized || serialized.trim() === "" || serialized.trim() === "{}" || serialized.trim() === "null") {
    return {
      data: { suggested_context_items: [] },
      meta: { agentName: "context_extractor", durationMs: Date.now() - startTime, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
  }

  const userMessage = `SOURCE AGENT: ${agentRole}
DOCUMENT TYPE: ${documentType ?? "Tech Spec"}

AGENT OUTPUT TO ANALYZE:
${serialized}

Extract the reusable context items now as the JSON object.`;

  const abort = new AbortController();
  const timeoutId = setTimeout(() => abort.abort(), 2 * 60 * 1000); // 2 min hard limit

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: EXTRACTOR_MODEL,
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
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

  const data = parseSuggestions(text);
  const inputTokens = json.usage?.input_tokens ?? 0;
  const outputTokens = json.usage?.output_tokens ?? 0;

  return {
    data,
    meta: {
      agentName: "context_extractor",
      durationMs: Date.now() - startTime,
      inputTokens,
      outputTokens,
      costUsd: (inputTokens / 1_000_000) * PRICE_INPUT_PER_M + (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M,
    },
  };
}
