// Agent Studio ↔ DCL adapter (thin).
//
// This is the ONLY place that binds the generic DCL core (lib/dcl/*) to Agent
// Studio's domain: its agent pipeline roles, its context-type taxonomy, the
// classification/section policy, the per-role task text, and the mapping from the
// Web3 intake form to a base "Context v0". The DCL core stays domain-agnostic;
// everything Web3/ProofFlow/document-specific is confined here and to the agents.
//
// Agent Studio code imports DCL exclusively through this module.

import {
  buildAndRender as coreBuildAndRender,
  type PackageConfig,
  type PackageContext,
  type SectionTypeMap,
} from "./dcl/package";
import {
  materialize as coreMaterialize,
  seedContextItems,
  type ClassificationPolicy,
} from "./dcl/classify";
import type { ContextItem, SuggestedContextItem } from "./dcl/types";

// Re-export the generic pieces Agent Studio uses, so callers have one import surface.
export { ENABLE_DCL } from "./dcl/types";
export type { ContextItem, ContextStatus, SuggestedContextItem } from "./dcl/types";
export type { ContextPackage } from "./dcl/package";

// ── Agent Studio domain vocabulary ───────────────────────────────────────────
export type AgentRole =
  | "research"
  | "writer"
  | "qa"
  | "critic"
  | "implementation_architect"
  | "revise"
  | "final_qa";

const ALL_ROLES: AgentRole[] = [
  "research", "writer", "qa", "critic", "implementation_architect", "revise", "final_qa",
];

// Review-type agents that may also see flagged (review_required) context.
const REVIEW_ROLES: ReadonlySet<string> = new Set<string>([
  "qa", "critic", "implementation_architect", "revise", "final_qa",
]);

// Context types that always carry strategic / external-claim weight → flag for review.
const HIGH_IMPACT_TYPES: ReadonlySet<string> = new Set<string>([
  "decision", "risk", "assumption", "market_claim", "security_issue", "legal_issue",
]);

// Which Agent Studio context types fall into each generic package section bucket.
const SECTION_TYPES: SectionTypeMap = {
  relevantConstraints: ["constraint", "agent_instruction"],
  acceptedDecisions: ["decision", "assumption"],
  knownRisks: ["risk", "market_claim", "security_issue", "legal_issue"],
  technicalGaps: ["technical_gap", "source_requirement"],
  openQuestions: ["open_question"],
  reviewFindings: ["review_finding", "formatting_issue"],
};

const TASK_BY_ROLE: Record<AgentRole, string> = {
  research: "Research the project and produce a grounded research brief with sources.",
  writer: "Write the full client deliverable grounded in the validated context below.",
  qa: "Review the draft for quality, completeness, and requirement coverage.",
  critic: "Adversarially attack the draft for unsupported claims, contradictions, and risks.",
  implementation_architect: "Review the draft for build-readiness and concrete implementation gaps.",
  revise: "Revise the draft, resolving every accepted finding and respecting all constraints.",
  final_qa: "Final acceptance check against unresolved high-risk items and acceptance criteria.",
};

const POLICY: ClassificationPolicy = { highImpactTypes: HIGH_IMPACT_TYPES };
const PACKAGE_CONFIG: PackageConfig = { reviewRoles: REVIEW_ROLES, sectionTypes: SECTION_TYPES };

// Base project context (Context v0) derived from the Web3 intake form.
export interface BaseContext {
  projectGoal: string;
  documentType: string;
  targetAudience: string;
  mvpScope: string;
  knownConstraints: string[];
  outputRequirements: string[];
}

// ── Thin wrappers over the generic core (inject the domain policy/config) ─────

export function materialize(
  suggested: SuggestedContextItem[],
  sourceAgent: AgentRole | "base",
  createdAt: string,
): ContextItem[] {
  return coreMaterialize(suggested, sourceAgent, createdAt, POLICY);
}

// Seed Context v0 items from base project context. Domain values (document type,
// "web3") ride along in the opaque metadata / domain_tags fields — never as typed
// core fields, so the core treats them as opaque.
export function seedBaseContextItems(base: BaseContext, createdAt: string): ContextItem[] {
  return seedContextItems(base.knownConstraints, {
    appliesTo: ALL_ROLES,
    createdAt,
    type: "constraint",
    riskLevel: "medium",
    status: "auto_accepted",
    confidence: 1,
    sourceAgent: "base",
    reason: "Base project constraint from intake form.",
    metadata: { documentType: base.documentType },
    domainTags: ["web3", base.documentType],
  });
}

export function buildAndRender(base: BaseContext, items: ContextItem[], role: AgentRole): string {
  const ctx: PackageContext = {
    projectGoal: base.projectGoal,
    currentTask: TASK_BY_ROLE[role],
    outputRequirements: base.outputRequirements,
  };
  return coreBuildAndRender(ctx, items, role, PACKAGE_CONFIG);
}

// Derive Context v0 (base context) from the raw Web3 intake form.
export function baseContextFromIntake(form: Record<string, string>): BaseContext {
  const constraints: string[] = [];
  if (form.blockchain) constraints.push(`Target blockchain / chain context: ${form.blockchain}`);
  if (form.timeline) constraints.push(`Timeline constraint: ${form.timeline}`);
  if (form.budget) constraints.push(`Budget constraint: ${form.budget}`);
  if (form.existingCode && form.existingCode.toLowerCase() !== "none")
    constraints.push(`Existing code to build on: ${form.existingCode}`);

  return {
    projectGoal: form.concept || form.projectName || "",
    documentType: form.documentNeeds || "Tech Spec",
    targetAudience: form.targetAudience || "",
    mvpScope: form.documentNeeds || "",
    knownConstraints: constraints,
    outputRequirements: [
      `Produce a client-ready ${form.documentNeeds || "Tech Spec"} document.`,
      "Every quantitative or market claim must be sourced or marked as an estimate.",
      "Stay within the stated MVP scope, timeline, and budget.",
    ],
  };
}
