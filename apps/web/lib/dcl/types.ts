// Dynamic Context Layer (DCL) — generic core types.
//
// This module is DOMAIN-AGNOSTIC. It knows nothing about any specific application,
// its agent pipeline, its products, its industry or deliverable concepts, or any
// specific prompt. All such knowledge lives in the adapter (lib/dcl-adapter.ts)
// and in the application's agents themselves.
//
// Core vocabulary (generic): context_items, agent_outputs, agent_runs, artifacts,
// context_packages, context_snapshots. Roles and context "types" are opaque strings;
// any domain-specific value rides along in the opaque `metadata` / `domain_tags`
// fields and is never interpreted by the core.
//
// MVP scope: items live in caller state for the duration of a session. There is no
// persistence layer yet (intentional). Everything is gated by ENABLE_DCL.

// Lifecycle status of a context item — generic, not domain-specific.
export type ContextStatus =
  | "suggested"
  | "auto_accepted"
  | "review_required"
  | "accepted"
  | "rejected"
  | "superseded"
  | "archived";

// Generic severity scale.
export type RiskLevel = "low" | "medium" | "high" | "critical";

// What an extractor recommends before the core classifies it.
export type RecommendedStatus = "auto_accepted" | "review_required" | "rejected_or_needs_source";

// A raw suggestion (e.g. from a Context Extractor) before classification.
// `type` and `applies_to` are opaque strings — the core never enumerates them.
export interface SuggestedContextItem {
  type: string;
  content: string;
  risk_level: RiskLevel;
  confidence: number;
  recommended_status: RecommendedStatus;
  applies_to: string[];
  reason?: string;
  // Opaque domain payload — never interpreted by the core.
  metadata?: Record<string, unknown>;
  domain_tags?: string[];
}

// A stored, classified context item.
export interface ContextItem {
  id: string;
  type: string;
  content: string;
  source_agent: string;
  status: ContextStatus;
  risk_level: RiskLevel;
  confidence: number;
  applies_to: string[];
  reason?: string;
  // Opaque domain payload — never interpreted by the core.
  metadata?: Record<string, unknown>;
  domain_tags?: string[];
  created_at: string;
}

// ── Generic model entities (req. 4) ──────────────────────────────────────────
// Lightweight generic shapes establishing the core vocabulary. Persistence of
// these is out of scope for the in-session MVP; they exist so adapters speak in
// generic terms and domain data stays in metadata/domain_tags.

export interface AgentOutput {
  agent_role: string;        // opaque role name
  output: unknown;           // raw agent output, opaque to the core
  artifact_id?: string;
  metadata?: Record<string, unknown>;
  domain_tags?: string[];
}

export interface AgentRun {
  id: string;
  agent_role: string;
  status: string;
  context_package_id?: string;
  output_artifact_id?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
  domain_tags?: string[];
}

export interface Artifact {
  id: string;
  content: unknown;          // opaque
  created_at: string;
  metadata?: Record<string, unknown>;
  domain_tags?: string[];
}

export interface ContextSnapshot {
  id: string;
  version: number;
  stage: string;             // opaque stage label
  context_item_ids: string[];
  created_at: string;
  metadata?: Record<string, unknown>;
  domain_tags?: string[];
}

// ── Configuration ────────────────────────────────────────────────────────────
// Read on the client (NEXT_PUBLIC_) so callers can decide whether to run DCL at
// all. When false, the caller skips DCL entirely and behaves exactly as before.
export const ENABLE_DCL =
  (process.env.NEXT_PUBLIC_ENABLE_DCL ?? "true").toLowerCase() !== "false";

// Operator view toggle. Default "0" => hidden (the public, client-facing
// deployment). When "1" (or "true") the operator sees the internal DCL/cost
// instrumentation: the token/cost counter chip, the Dynamic Context panel, and
// per-agent diagnostics. This gates UI VISIBILITY ONLY — cost fields, context
// items, snapshots and gate runs are still computed and persisted exactly the
// same regardless of the flag.
export const OPERATOR_MODE =
  ["1", "true"].includes((process.env.NEXT_PUBLIC_OPERATOR_MODE ?? "0").toLowerCase());

export const DCL_MAX_CONTEXT_ITEMS_PER_PACKAGE = 30;
