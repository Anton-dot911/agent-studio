// Final QA Gate worker — domain-aware acceptance judgment.
//
// Mirrors critic.ts / architect.ts (non-streaming Anthropic call, returns
// { data, meta }). This is where the model and the acceptance criteria live; the
// generic loop policy (lib/dcl/gates/gate.ts) never calls a model. The worker
// returns a raw GateJudgment as result.data — the orchestrator feeds that into
// decideGateAction to get an action.
//
// The gate is an ACCEPTANCE check, not a rewrite: it judges the final document
// against the acceptance criteria, the unresolved high-risk flags, internal
// consistency, and whether any hard quantitative/market claim is left unsourced.

import type { GenerationResult } from "./generate";
import { parseJsonLoose } from "./json-repair";
import { maybeMockFinalQa } from "./mock";

// Gate judge model. Default is the most capable judge; set a Sonnet string to cut cost.
export const DCL_GATE_MODEL = process.env.DCL_GATE_MODEL || "claude-opus-4-8";

// Pricing per MTok (input/output), keyed by model-family prefix. Default to the
// most capable judge's rates when the model string is unrecognised.
function priceFor(model: string): { input: number; output: number } {
  const m = model.toLowerCase();
  if (m.includes("sonnet")) return { input: 3.0, output: 15.0 };
  // Opus family (and unknown -> conservative default).
  return { input: 5.0, output: 25.0 };
}

const GATE_PROMPT = `You are the Final QA Gate in a multi-agent document generation pipeline.

Your job is a single ACCEPTANCE decision on the FINAL, post-revision document. You do
NOT rewrite the document. You judge whether it is ready to deliver to a paying client.

Judge the document against ALL of:
1. The ACCEPTANCE CRITERIA provided below — each must be met.
2. The UNRESOLVED FLAGS provided below — high-risk items that were never resolved.
3. Internal consistency — no section contradicts another.
4. Sourcing — no hard quantitative or market claim is stated as fact without a source
   or an explicit "estimate" marker.
5. Completeness — no required section is missing or empty.

Choose exactly one verdict:
- "fail": ONLY for blocking defects — an unsupported hard number left in, a real
  contradiction, a required section missing or empty, or a criterion clearly unmet.
- "pass_with_minor_fixes": non-blocking polish that does not justify another full
  revise cycle. The document is deliverable as-is.
- "pass": the document is client-ready with nothing worth flagging.

OUTPUT FORMAT — respond with ONLY a valid JSON object. No markdown, no code fences.
Start with { and end with }.

{
  "verdict": "pass" | "pass_with_minor_fixes" | "fail",
  "findings": [
    { "severity": "low" | "medium" | "high" | "critical", "message": "string", "applies_to": ["section or role label"] }
  ],
  "summary": "one-paragraph acceptance summary"
}

RULES:
- Reserve "fail" for genuinely blocking defects. If in doubt between fail and
  pass_with_minor_fixes, and the issue does not block delivery, choose the latter.
- findings must be concrete and reference where they apply.
- Output must be complete, valid JSON.`;

export interface FinalQaInput {
  techSpec: unknown;                 // the final (post-revise) document JSON
  intakeData: Record<string, string>;
  documentType?: string;
  researchReport?: unknown;
  acceptanceCriteria: string[];      // supplied by the adapter from BaseContext.outputRequirements
  unresolvedFlags: string[];         // content strings of any still-review_required context items
  contextPackage?: string;           // DCL package rendered for role "final_qa" (additive, may be "")
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens: number; output_tokens: number };
}

function parseJson(raw: string): unknown {
  try {
    return parseJsonLoose(raw);
  } catch {
    throw new Error("Failed to parse final QA response as JSON");
  }
}

export async function generateFinalQa(apiKey: string, input: FinalQaInput): Promise<GenerationResult> {
  // Fixture short-circuit: return a deterministic verdict with zero API spend.
  const mock = maybeMockFinalQa();
  if (mock) return mock;

  const {
    techSpec,
    intakeData,
    documentType,
    researchReport,
    acceptanceCriteria,
    unresolvedFlags,
    contextPackage,
  } = input;
  const startTime = Date.now();

  const userMessage = `${contextPackage ? `${contextPackage}\n\n` : ""}DOCUMENT_TYPE: ${documentType ?? intakeData?.documentNeeds ?? "Technical Specification"}

ACCEPTANCE_CRITERIA (every item must be met):
${acceptanceCriteria.length > 0 ? acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n") : "(none provided)"}

UNRESOLVED_FLAGS (high-risk items that were never resolved — weigh these heavily):
${unresolvedFlags.length > 0 ? unresolvedFlags.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(none)"}

${researchReport ? `RESEARCH_BRIEF (what the document is allowed to claim as grounded):\n${JSON.stringify(researchReport, null, 2)}\n\n` : ""}FINAL_DOCUMENT (judge acceptance of this):
${JSON.stringify(techSpec, null, 2)}

Return your acceptance judgment now as the JSON object.`;

  const abort = new AbortController();
  const timeoutId = setTimeout(() => abort.abort(), 10 * 60 * 1000);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: DCL_GATE_MODEL,
      max_tokens: 4000,
      system: GATE_PROMPT,
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

  const data = parseJson(text);
  const inputTokens = json.usage?.input_tokens ?? 0;
  const outputTokens = json.usage?.output_tokens ?? 0;
  const price = priceFor(DCL_GATE_MODEL);

  return {
    data,
    meta: {
      agentName: "final_qa",
      durationMs: Date.now() - startTime,
      inputTokens,
      outputTokens,
      costUsd: (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output,
    },
  };
}
