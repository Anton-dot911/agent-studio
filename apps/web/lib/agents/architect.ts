// Implementation Architect agent.
//
// Runs in PARALLEL with QA and Critic (all three fire after the Writer). While QA
// checks quality/requirements and Critic attacks credibility, the Implementation
// Architect asks one question: "Can a developer BUILD this without guessing?"
//
// It inspects the draft for concrete build-readiness gaps — missing API contracts,
// database schema, state machines, deployment/testing plans, edge cases, and build
// blockers — and returns STRICT JSON the Reviser (and the Context Extractor) can
// consume programmatically.
//
// Runs on Sonnet 4.6 (same tier as Writer/Critic/QA): a build reviewer must reason
// at least as well as the writer it reviews.

export const ARCHITECT_MODEL = "claude-sonnet-4-6";

const PRICE_INPUT_PER_M = 3;
const PRICE_OUTPUT_PER_M = 15;

const ARCHITECT_PROMPT = `You are the Implementation Architect in a multi-agent document generation pipeline.

Pipeline context:
Research -> Writer -> QA / Critic / Implementation Architect (parallel) -> Revise

Your role is NOT to polish wording or attack credibility. Your single job is to judge
whether a competent development team could BUILD what this document describes WITHOUT
having to guess. You read the draft the way a senior engineer reads a spec before
committing to an estimate.

Inspect for concrete build-readiness gaps:
A. API surface — are request/response shapes, endpoints, auth, and error handling
   specified, or only named? Flag any "the API will handle X" hand-waving.
B. Data model — are entities, fields, types, relationships, and storage defined?
   Flag missing schema, ambiguous types, or undefined persistence.
C. State & control flow — are key state machines, job lifecycles, retries, idempotency,
   and async boundaries defined? Flag undefined transitions.
D. Integrations — for every external system named (chains, LLMs, payment, email,
   storage), is the integration contract concrete (SDK, version, rate limits, failure
   mode)? Flag plausible-sounding but unspecified integrations.
E. Deployment & infra — environments, build/runtime, secrets, scaling, observability,
   migrations. Flag anything a dev would have to invent.
F. Testing & verification — unit/integration/e2e scope, test data, acceptance criteria.
   Flag missing or vague testing plans.
G. Edge cases & failure modes — empty inputs, partial failures, timeouts, malformed
   data, concurrency. Flag unhandled ones that matter.
H. Build blockers — anything that makes the stated timeline/budget infeasible as written.

Use the research brief and the validated context package (if provided) to judge which
constraints (chain, budget, timeline, MVP scope) the implementation must respect. Do
not recommend gold-plating beyond the stated MVP scope — flag scope creep too.

OUTPUT FORMAT — respond with ONLY a valid JSON object. No markdown, no code fences.
Start with { and end with }.

{
  "verdict": {
    "buildable": false,
    "buildReadinessScore": 0,
    "biggestBlocker": "string (one sentence)",
    "summary": "string (3-5 sentences: could a team build this as written?)"
  },
  "gaps": [
    {
      "area": "api | data_model | state_flow | integration | deployment | testing | edge_case | scope",
      "severity": "critical | high | medium | low",
      "title": "string (short)",
      "problem": "string (what is missing or ambiguous)",
      "whyItBlocks": "string (what a developer cannot do without it)",
      "fix": "string (concrete instruction for the Reviser: what to add/specify)"
    }
  ],
  "missingArtifacts": ["string (e.g. 'database schema', 'API error contract', 'deployment runbook')"],
  "scopeRisks": [
    { "item": "string", "issue": "over_scoped | under_specified", "recommendation": "string" }
  ],
  "revisionBrief": [
    { "instruction": "string (add/specify/define ...)", "reason": "string", "priority": "critical | high | medium | low" }
  ]
}

RULES:
- Provide up to 10 gaps, most blocking first. Real, concrete gaps only.
- Do not invent requirements outside the document's stated scope.
- revisionBrief must be specific enough that the Reviser needs no follow-up questions.
- Output must be complete, valid JSON.`;

export interface ArchitectInput {
  techSpec: unknown;
  researchReport: unknown;
  intakeData?: Record<string, string>;
  documentType?: string;
  contextPackage?: string;
}

export interface ArchitectResult {
  data: unknown;
  meta: {
    agentName: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

import { parseJsonLoose } from "./json-repair";

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens: number; output_tokens: number };
}

function parseJson(raw: string): unknown {
  try {
    return parseJsonLoose(raw);
  } catch {
    throw new Error("Failed to parse architect response as JSON");
  }
}

export async function generateArchitect(apiKey: string, input: ArchitectInput): Promise<ArchitectResult> {
  const { techSpec, researchReport, intakeData, documentType, contextPackage } = input;
  const startTime = Date.now();

  const userMessage = `DOCUMENT_TYPE: ${documentType ?? intakeData?.documentNeeds ?? "Technical Specification"}
PROJECT: ${intakeData?.projectName ?? ""}
BLOCKCHAIN: ${intakeData?.blockchain ?? ""}
TIMELINE: ${intakeData?.timeline ?? ""}
BUDGET: ${intakeData?.budget ?? ""}
${contextPackage ? `\n${contextPackage}\n` : ""}
RESEARCH_BRIEF (grounding facts):
${JSON.stringify(researchReport, null, 2)}

DOCUMENT_DRAFT (assess build-readiness of this):
${JSON.stringify(techSpec, null, 2)}

Produce your structured build-readiness review now as the JSON object.`;

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
      model: ARCHITECT_MODEL,
      max_tokens: 12000,
      system: ARCHITECT_PROMPT,
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

  return {
    data,
    meta: {
      agentName: "implementation_architect",
      durationMs: Date.now() - startTime,
      inputTokens,
      outputTokens,
      costUsd: (inputTokens / 1_000_000) * PRICE_INPUT_PER_M + (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M,
    },
  };
}
