// Dynamic Context Layer (DCL) — shared types.
//
// The DCL is an in-session context-management layer. It sits between the agents
// in the existing Research → Writer → [QA ∥ Critic ∥ Implementation Architect] →
// Revise pipeline. After each agent runs, a Context Extractor distills its output
// into structured, reusable Context Items. Before each agent runs, a Context
// Package Builder assembles the role-relevant, validated subset of those items and
// injects it into the agent prompt.
//
// MVP scope: items live in client (run-page) state for the duration of a session.
// There is no persistence layer yet — this is intentional (see implementation brief
// non-goals). Everything is gated by ENABLE_DCL so the pipeline can fall back to its
// previous behaviour with a single flag.

export type ContextStatus =
  | "suggested"
  | "auto_accepted"
  | "review_required"
  | "accepted"
  | "rejected"
  | "superseded"
  | "archived";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ContextType =
  | "goal"
  | "constraint"
  | "decision"
  | "risk"
  | "assumption"
  | "open_question"
  | "technical_gap"
  | "market_claim"
  | "security_issue"
  | "legal_issue"
  | "formatting_issue"
  | "source_requirement"
  | "review_finding"
  | "agent_instruction";

export type AgentRole =
  | "research"
  | "writer"
  | "qa"
  | "critic"
  | "implementation_architect"
  | "revise"
  | "final_qa";

// What the Context Extractor returns per item before client-side classification.
export type RecommendedStatus = "auto_accepted" | "review_required" | "rejected_or_needs_source";

export interface SuggestedContextItem {
  type: ContextType;
  content: string;
  risk_level: RiskLevel;
  confidence: number;
  recommended_status: RecommendedStatus;
  applies_to: AgentRole[];
  reason?: string;
}

export interface ContextItem {
  id: string;
  type: ContextType;
  content: string;
  source_agent: AgentRole | "base";
  status: ContextStatus;
  risk_level: RiskLevel;
  confidence: number;
  applies_to: AgentRole[];
  reason?: string;
  created_at: string;
}

// Base project context (Context v0) derived from the intake form.
export interface BaseContext {
  projectGoal: string;
  documentType: string;
  targetAudience: string;
  mvpScope: string;
  knownConstraints: string[];
  outputRequirements: string[];
}

// ── Configuration ────────────────────────────────────────────────────────────
// The flag is read on the client (NEXT_PUBLIC_) so the run page can decide whether
// to run the DCL steps at all. When false, the pipeline behaves exactly as before.
export const ENABLE_DCL =
  (process.env.NEXT_PUBLIC_ENABLE_DCL ?? "true").toLowerCase() !== "false";

export const DCL_MAX_CONTEXT_ITEMS_PER_PACKAGE = 30;

// Types that always carry strategic / external-claim weight and therefore must be
// flagged for review (never silently auto-accepted) regardless of the model's vote.
export const HIGH_IMPACT_TYPES: ReadonlySet<ContextType> = new Set<ContextType>([
  "decision",
  "risk",
  "assumption",
  "market_claim",
  "security_issue",
  "legal_issue",
]);

// Review-type agents that benefit from seeing unresolved / flagged context.
export const REVIEW_ROLES: ReadonlySet<AgentRole> = new Set<AgentRole>([
  "qa",
  "critic",
  "implementation_architect",
  "revise",
  "final_qa",
]);
