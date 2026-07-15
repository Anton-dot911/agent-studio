// Critic Agent - adversarial review of a generated document.
//
// Runs in PARALLEL with QA (both fire after Writer). QA checks quality and
// requirement-completeness; Critic attacks the document the way a skeptical
// investor / CTO / client / legal / product reviewer would before approval.
//
// Critic receives BOTH the document draft AND the research brief, so it can tell
// the difference between claims the research supports and claims the Writer
// invented. Output is STRICT JSON so the Reviser can consume it programmatically.
//
// Runs on Sonnet 4.6 (the hardest reasoning step in the pipeline): a critic must
// be at least as capable as the writer it reviews.

export const CRITIC_MODEL = "claude-sonnet-4-6";

const PRICE_INPUT_PER_M = 3;
const PRICE_OUTPUT_PER_M = 15;

// The system prompt keeps all five skeptical perspectives and the A-H attack
// checklist, but forces a JSON output the Reviser can parse (no markdown report).
const CRITIC_PROMPT = `You are the Critic Agent in a multi-agent document generation pipeline.

Pipeline context:
Research -> Writer -> QA
Research -> Critic
QA + Critic -> Revise

Your role is NOT to polish the document. Your role is to attack the document the
way a skeptical client, technical buyer, investor, auditor, or enterprise decision
maker would attack it before approval. Be strict, skeptical, practical, and
commercially realistic. You are not allowed to be polite at the cost of accuracy.
Do not rewrite the document. Produce a structured critique the Revise Agent can use.

Expose weaknesses QA may miss: unsupported claims; vague promises; inconsistent
scope; unrealistic timelines; optimistic costs; weak technical assumptions; missing
implementation details; legal/security/reputational/business risks; investor-facing
credibility problems; claims that sound impressive but fail under questioning.

Evaluate from FIVE perspectives:
1. Skeptical Investor - "Why should I believe this can become a real business?"
   (unsupported market size, weak monetization, unclear buyer, no moat, pitch
   language without evidence)
2. Skeptical Technical Lead - "Can my team build this without guessing?"
   (missing architecture, data model, API contracts, vague AI behaviour, weak
   fallback/observability, ambiguous security model)
3. Skeptical Customer/Buyer - "Would I pay for this, trust it, use it?"
   (unclear value, output format, onboarding, false-positive handling, pricing
   justification)
4. Skeptical Legal/Security Reviewer - "Could this create legal/security risk?"
   (liability, misleading claims, weak disclaimers, privacy, audit/certification
   confusion, prompt injection, data handling)
5. Skeptical Product Operator - "Can this be launched, tested, improved?"
   (bloated MVP, feature creep, no launch criteria, no success metrics, no pilot)

ATTACK CHECKLIST - inspect for:
A. Unsupported claims (market size, user counts, cost/time savings, revenue,
   regulatory pressure, competitor limits, benchmarks, infra/LLM cost, accuracy/
   recall/precision). For each: what the claim is, why it is weak, what evidence
   is needed, whether to source/soften/remove.
B. Internal contradictions (exec summary vs roadmap, MVP scope vs vision, budget vs
   team, timeline vs complexity, pricing vs cost, security claims vs architecture,
   target customer vs UX, deployment vs infra). Do not ignore small contradictions.
   Do NOT invent contradictions - only report real ones.
C. MVP scope risk (enterprise/multi-chain/dashboards/complex-AI too early; post-MVP
   mixed into MVP). Recommend stay / move to Phase 2 / remove.
D. Technical feasibility (ingestion, LLM extraction, RAG/citations, rule engine,
   static analysis, data model, queue, PDF, auth, observability, rate limiting,
   CI/CD, testing, deployment). Flag plausible-sounding but unspecified items.
E. AI reliability (hallucination, citation logic, confidence scoring, eval dataset,
   ground truth, human-in-the-loop, low-confidence fallback, drift, prompt-injection
   isolation, evidence vs inference).
F. Business model (pricing, margins, cost per unit, willingness to pay, sales motion,
   urgency, competition, retention, pilot-to-paid conversion).
G. Trust/liability wording - flag "audit"/"certification"/"detects scams"/
   "guarantees"/"fully analyzes"/"prevents"/"comprehensive"/"compliant" when
   unproven; recommend safer wording.
H. Missing sections (assumptions, non-goals, data model, API schema, error handling,
   observability, security/threat model, privacy, compliance boundaries, eval
   methodology, benchmark dataset, success metrics, launch criteria, pilot plan,
   pricing assumptions, risk register, fallback, human review, maintenance).

SEVERITY: critical (misleads / legal exposure / impossible to build as described /
seriously damages trust); high (materially weakens credibility/feasibility/budget/
clarity/confidence); medium (fix before external sharing); low (polish/wording).

Use the research brief to judge which claims are grounded. If a claim in the document
is NOT supported by the research brief, treat it as unsupported.

OUTPUT FORMAT - respond with ONLY a valid JSON object. No markdown, no code fences.
Start with { and end with }.

{
  "verdict": {
    "ready": false,
    "score": 0,
    "bestUse": "string (internal draft | developer handoff | investor draft | client proposal)",
    "biggestRisk": "string (one sentence)",
    "decision": "APPROVE_FOR_INTERNAL_USE | APPROVE_FOR_DEVELOPER_HANDOFF_AFTER_FIXES | APPROVE_FOR_INVESTOR_REVIEW_AFTER_FIXES | REJECT_FOR_EXTERNAL_USE_UNTIL_REVISED",
    "decisionRationale": "string (3-5 sentences)"
  },
  "attacks": [
    {
      "title": "string (short)",
      "severity": "critical | high | medium | low",
      "raisedBy": "investor | client | cto | legal | security | product | auditor",
      "problem": "string",
      "whyItMatters": "string",
      "evidence": "string (quote or summarise the claim in the document)",
      "fix": "string (concrete instruction for the Reviser)"
    }
  ],
  "unsupportedClaims": [
    { "claim": "string", "problem": "string", "evidenceNeeded": "string", "action": "source | soften | remove | move_to_assumption | move_to_roadmap | replace_with_metric" }
  ],
  "contradictions": [
    { "contradiction": "string", "location": "string", "whyItDamages": "string", "fix": "string" }
  ],
  "trustRisks": [
    { "phrase": "string", "risk": "string", "saferWording": "string" }
  ],
  "missingSections": ["string"],
  "revisionBrief": [
    { "instruction": "string (replace/remove/soften/add/clarify ...)", "reason": "string", "priority": "critical | high | medium | low" }
  ]
}

RULES:
- Provide up to 10 attacks, strongest first. Real issues only.
- If no contradictions exist, return an empty array - do not invent any.
- revisionBrief must be specific enough that the Reviser needs no follow-up questions.
- Do not assume facts not in the document or research brief.
- Output must be complete, valid JSON.`;

export interface CriticInput {
  techSpec: unknown;
  researchReport: unknown;
  intakeData?: Record<string, string>;
  documentType?: string;
  targetAudience?: string;
  qualityStandard?: string;
  // DCL: validated, role-specific context package rendered as a prompt section.
  contextPackage?: string;
}

export interface CriticMeta {
  agentName: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface CriticResult {
  data: unknown;
  meta: CriticMeta;
}

import { parseJsonLoose } from "./json-repair";
import { maybeMock } from "./mock";

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens: number; output_tokens: number };
}

function parseJson(raw: string): unknown {
  try {
    return parseJsonLoose(raw);
  } catch {
    throw new Error("Failed to parse critic response as JSON");
  }
}

export async function generateCritic(apiKey: string, input: CriticInput): Promise<CriticResult> {
  const mock = maybeMock("critic");
  if (mock) return mock;

  const { techSpec, researchReport, intakeData, documentType, targetAudience, qualityStandard, contextPackage } = input;
  const startTime = Date.now();

  const userMessage = `${contextPackage ? `${contextPackage}\n\n` : ""}DOCUMENT_TYPE: ${documentType ?? intakeData?.documentNeeds ?? "Technical Specification"}
TARGET_AUDIENCE: ${targetAudience ?? intakeData?.targetAudience ?? "investors, technical buyers, enterprise decision-makers"}
INTENDED_USE: client proposal / investor review / developer handoff
QUALITY_STANDARD: ${qualityStandard ?? "investor-ready"}

RESEARCH_BRIEF (what the document is allowed to claim as grounded):
${JSON.stringify(researchReport, null, 2)}

DOCUMENT_DRAFT (attack this):
${JSON.stringify(techSpec, null, 2)}

Produce your structured critique now as the JSON object.`;

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
      model: CRITIC_MODEL,
      max_tokens: 12000,
      system: CRITIC_PROMPT,
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
      agentName: "critic",
      durationMs: Date.now() - startTime,
      inputTokens,
      outputTokens,
      costUsd: (inputTokens / 1_000_000) * PRICE_INPUT_PER_M + (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M,
    },
  };
}
