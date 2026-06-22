// Shared document-generation logic for the Writer and Reviser agents.
//
// Used by the Netlify Background Function (apps/web/netlify/functions/generate-background)
// which runs up to 15 min — well past the ~60s edge/serverless limits — so we can use
// the higher-quality Sonnet model and the full token budget without timing out.
//
// These calls are NON-streaming: the background worker only needs the final JSON, and
// the client tracks progress by polling the job status in Supabase.

// Writer and Reviser both run on Sonnet 4.6 (same model that does QA) for quality.
export const GENERATION_MODEL = "claude-sonnet-4-6";

// Sonnet 4.6 pricing per million tokens.
const PRICE_INPUT_PER_M = 3;
const PRICE_OUTPUT_PER_M = 15;

const OUTPUT_STRUCTURE = `
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

Rules (STRICT):
- Each section has 2 to 3 blocks MAX. Be concise and dense.
- Paragraphs: 2 to 3 sentences each. No filler, no repetition.
- Bullets: 3 to 5 short items, one line each.
- Use exactly ONE "highlight" per section for the key takeaway.
- Use "table" only where specified below. Keep tables to 3 to 5 rows.
- Use "code" only once or twice total, short snippets (under 12 lines).
- Write concrete content grounded in the research. This is a paid client deliverable.
- Prioritise finishing all 10 sections over depth in any one.`;

const TECH_SPEC_PROMPT = `You are a senior Web3 technical writer producing a complete Technical Specification document.
${OUTPUT_STRUCTURE}

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

Use "table" only in: Smart Contract Design (functions), Deployment Roadmap (phases + timeline), Cost Estimation (USD ranges per workstream).`;

const TOKENOMICS_PROMPT = `You are a senior Web3 tokenomics analyst producing a complete Tokenomics document.
${OUTPUT_STRUCTURE}

Produce EXACTLY these 10 sections in this order:
1. Executive Summary
2. Token Overview
3. Economic Model
4. Token Distribution
5. Vesting & Lock-up Schedule
6. Utility & Demand Drivers
7. Governance Framework
8. Market Comparables
9. Risk Analysis
10. Launch Roadmap & Cost Estimate

Use "table" only in: Token Distribution (category + % + amount), Vesting & Lock-up Schedule (stakeholder + cliff + vesting period), Launch Roadmap & Cost Estimate (phase + timeline + budget).`;

const DEFI_AUDIT_PROMPT = `You are a senior Web3 security researcher producing a DeFi Audit Preparation document.
${OUTPUT_STRUCTURE}

Produce EXACTLY these 10 sections in this order:
1. Executive Summary
2. Protocol Overview
3. Architecture & Smart Contracts
4. Attack Surface Analysis
5. Access Controls & Permissions
6. Economic Attack Vectors
7. Testing & Verification Strategy
8. Known Vulnerabilities Checklist
9. Remediation Roadmap
10. Audit Timeline & Cost Estimate

Use "table" only in: Architecture & Smart Contracts (contract name + purpose + risk level), Known Vulnerabilities Checklist (vulnerability + severity + status), Audit Timeline & Cost Estimate (phase + duration + cost range).
Use "code" for one representative function signature or interface that illustrates the main risk area.`;

const REVISE_PROMPT = `You are a senior technical editor. You receive a Technical Specification document and a QA report with issues. Produce a revised version that fixes all listed issues.

Respond with ONLY a valid JSON object. No markdown, no code fences. Start with { and end with }.

Keep the exact same structure as the input TechSpec:
{
  "title": "string",
  "subtitle": "string",
  "sections": [
    {
      "label": "string",
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

Rules:
- Keep all 10 sections with same labels
- Fix every critical issue — these are blocking
- Fix every major issue — these reduce quality
- Address minor issues where practical
- Address EVERY item in the Checklist — these are mandatory requirements the document must satisfy
- Same conciseness constraints as the original (2-3 blocks per section)
- Output must be complete and valid JSON`;

function getWriterSystemPrompt(documentType: string): string {
  const t = (documentType || "").toLowerCase();
  if (t.includes("tokenomics") || t.includes("token")) return TOKENOMICS_PROMPT;
  if (t.includes("audit") || t.includes("defi") || t.includes("security")) return DEFI_AUDIT_PROMPT;
  return TECH_SPEC_PROMPT;
}

export interface GenerationMeta {
  agentName: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface GenerationResult {
  data: unknown;
  meta: GenerationMeta;
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens: number; output_tokens: number };
}

// Non-streaming Anthropic Messages call. Returns the concatenated text and token usage.
async function callAnthropic(
  apiKey: string,
  system: string,
  userMessage: string,
  maxTokens = 8000,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: GENERATION_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error: ${res.status} ${errText}`);
  }

  const json = (await res.json()) as AnthropicResponse;
  const text = (json.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("");

  return {
    text,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}

function parseJsonDocument(raw: string): unknown {
  const clean = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(clean);
  } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Failed to parse model response as JSON");
  }
}

function costUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * PRICE_INPUT_PER_M + (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;
}

export interface WriterInput {
  intakeData: Record<string, string>;
  researchReport: unknown;
  checklistItems?: string[];
}

export async function generateWriter(apiKey: string, input: WriterInput): Promise<GenerationResult> {
  const { intakeData, researchReport, checklistItems } = input;
  const startTime = Date.now();
  const system = getWriterSystemPrompt(intakeData.documentNeeds ?? "tech spec");

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
Document Type: ${intakeData.documentNeeds}

RESEARCH REPORT (JSON):
${JSON.stringify(researchReport, null, 2)}
${checklistItems && checklistItems.length > 0 ? `
REVISION CHECKLIST (every item below MUST be addressed in the document):
${checklistItems.map((item, i) => `${i + 1}. ${item}`).join("\n")}
` : ""}
Write the full document now as the JSON object.`;

  const { text, inputTokens, outputTokens } = await callAnthropic(apiKey, system, userMessage);
  const data = parseJsonDocument(text);

  return {
    data,
    meta: {
      agentName: "writer",
      durationMs: Date.now() - startTime,
      inputTokens,
      outputTokens,
      costUsd: costUsd(inputTokens, outputTokens),
    },
  };
}

export interface ReviseInput {
  techSpec: unknown;
  qaReport: {
    criticalIssues: string[];
    majorIssues: string[];
    minorIssues: string[];
    humanChecklist: string[];
    summary: string;
  };
  intakeData?: Record<string, string>;
  documentType?: string;
}

export async function generateRevise(apiKey: string, input: ReviseInput): Promise<GenerationResult> {
  const { techSpec, qaReport, intakeData, documentType } = input;
  const startTime = Date.now();

  const issuesList = [
    ...qaReport.criticalIssues.map((i) => `[CRITICAL] ${i}`),
    ...qaReport.majorIssues.map((i) => `[MAJOR] ${i}`),
    ...qaReport.minorIssues.map((i) => `[MINOR] ${i}`),
  ].join("\n");

  const userMessage = `DOCUMENT TYPE: ${documentType ?? intakeData?.documentNeeds ?? "Tech Spec"}

QA REPORT SUMMARY:
${qaReport.summary}

ISSUES TO FIX:
${issuesList || "No issues — minor polish only"}

CHECKLIST (every item below MUST be addressed in the revised document):
${qaReport.humanChecklist.join("\n")}

${intakeData ? `PROJECT CONTEXT:\nBlockchain: ${intakeData.blockchain}\nBudget: ${intakeData.budget}\nTimeline: ${intakeData.timeline}\n` : ""}

CURRENT TECH SPEC TO REVISE:
${JSON.stringify(techSpec, null, 2)}

Apply all fixes and return the improved Tech Spec as JSON.`;

  const { text, inputTokens, outputTokens } = await callAnthropic(apiKey, REVISE_PROMPT, userMessage);
  const data = parseJsonDocument(text);

  return {
    data,
    meta: {
      agentName: "revise",
      durationMs: Date.now() - startTime,
      inputTokens,
      outputTokens,
      costUsd: costUsd(inputTokens, outputTokens),
    },
  };
}
