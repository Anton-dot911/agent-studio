// packages/agents/src/types.ts
// Core TypeScript contracts for all agents — NEVER change without updating all agents

// ─── Intake Form ─────────────────────────────────────────────────────────────

export interface IntakeFormData {
  projectName: string;         // 01. Назва проєкту
  concept: string;             // 01. Концепція (3–5 речень)
  problem: string;             // 02. Яку проблему вирішує
  targetAudience: string;      // 03. Цільова аудиторія
  blockchain: string;          // 04. Блокчейн / мережа
  existingCode: string;        // 05. Чи є вже код
  competitors: string;         // 06. Конкуренти (через кому)
  teamInfo: string;            // 07. Команда
  timeline: string;            // 08. Таймлайн
  budget: string;              // 09. Бюджет
  documentNeeds: string;       // 10. Що потрібно в документі
}

// ─── Base Agent I/O ──────────────────────────────────────────────────────────

export interface AgentInput {
  projectId: string;
  data: unknown;
  memoryContext?: string;      // результати semantic search по минулих кейсах
}

export interface AgentOutput<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta: {
    agentName: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    toolCallsCount: number;
  };
}

// ─── Research Agent ──────────────────────────────────────────────────────────

export interface ResearchAgentInput extends AgentInput {
  data: IntakeFormData;
}

export interface ResearchReport {
  projectSummary: string;
  problemAnalysis: {
    coreProblem: string;
    severity: "high" | "medium" | "low";
    existingSolutions: string[];
    gap: string;
  };
  marketContext: {
    sector: string;
    tam: string;
    growthTrend: string;
    keyDrivers: string[];
  };
  competitiveAnalysis: Array<{
    name: string;
    type: string;
    strengths: string[];
    weaknesses: string[];
    differentiationOpportunity: string;
  }>;
  technicalLandscape: {
    recommendedStack: string;
    recommendedBlockchain: string;
    blockchainRationale: string;
    keyLibraries: string[];
    knownRisks: string[];
    architectureNotes: string;
  };
  teamAssessment: {
    size: number;
    capability: "senior" | "mid-level" | "junior" | "unknown";
    timelineFeasibility: "realistic" | "tight" | "unrealistic";
    recommendedMvpScope: string;
    skillGaps: string[];
  };
  redFlags: string[];
  opportunities: string[];
  researchConfidence: "high" | "medium" | "low";
  notesForWriter: string;
}

export interface ResearchAgentOutput extends AgentOutput<ResearchReport> {}

// ─── Tech Spec Document ──────────────────────────────────────────────────────

export type DocBlock =
  | { type: "para"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "highlight"; label: string; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; text: string };

export interface DocSection {
  label: string;
  blocks: DocBlock[];
}

export interface TechSpec {
  title: string;
  subtitle: string;
  sections: DocSection[];
}

// ─── Writer Agent (Phase 2) ──────────────────────────────────────────────────

export type DocumentType = "tech_spec" | "tokenomics" | "defi_audit";

export interface WriterAgentInput extends AgentInput {
  data: {
    researchReport: ResearchReport;
    documentType: DocumentType;
  };
}

export interface WriterAgentOutput extends AgentOutput<TechSpec> {}

// ─── QA Agent (Phase 2) ──────────────────────────────────────────────────────

export interface QAAgentInput extends AgentInput {
  data: {
    techSpec: TechSpec;
    researchReport: ResearchReport;
  };
}

export interface QAReport {
  score: number;           // 1–10
  status: "approved" | "minor_revisions" | "major_revisions";
  criticalIssues: string[];
  majorIssues: string[];
  minorIssues: string[];
  humanChecklist: string[];
  summary: string;
}

export interface QAAgentOutput extends AgentOutput<QAReport> {}

// ─── Delivery Agent (Phase 2) ────────────────────────────────────────────────

export interface DeliveryAgentInput extends AgentInput {
  data: {
    techSpec: TechSpec;
    clientEmail: string;
    clientName?: string;
    projectName: string;
  };
}

export interface DeliveryResult {
  pdfGenerated: boolean;
  emailSent: boolean;
  emailId?: string;
  pdfUrl?: string;
}

export interface DeliveryAgentOutput extends AgentOutput<DeliveryResult> {}

// ─── Project Status ──────────────────────────────────────────────────────────

export type ProjectStatus =
  | "pending"       // замовлення прийнято
  | "researching"   // Research Agent працює
  | "writing"       // Writer Agent працює
  | "reviewing"     // QA Agent працює
  | "ready"         // очікує твого review
  | "delivered"     // PDF відправлено клієнту
  | "archived";     // завершено

export type AgentName = "research" | "writer" | "qa" | "delivery" | "orchestrator";

// ─── Cost calculation ────────────────────────────────────────────────────────

// claude-sonnet-4-20250514: $3/M input, $15/M output
export function calculateCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
}
