// DCL hybrid review logic — generic core.
//
// Turns a raw SuggestedContextItem into a stored ContextItem with a final status,
// using deterministic rules. Which `type` values count as "high impact" is supplied
// by the caller via ClassificationPolicy — the core does not enumerate domain types.
//
// Policy:
//   - recommended "rejected_or_needs_source"        → rejected
//   - high-impact type OR high/critical risk         → review_required
//   - recommended "review_required"                  → review_required
//   - otherwise                                      → auto_accepted

import type { ContextItem, ContextStatus, RiskLevel, SuggestedContextItem } from "./types";

// Domain-supplied classification policy. `highImpactTypes` holds opaque type strings.
export interface ClassificationPolicy {
  highImpactTypes: ReadonlySet<string>;
}

export function classifyStatus(item: SuggestedContextItem, policy: ClassificationPolicy): ContextStatus {
  if (item.recommended_status === "rejected_or_needs_source") return "rejected";

  const highImpact =
    policy.highImpactTypes.has(item.type) ||
    item.risk_level === "high" ||
    item.risk_level === "critical";

  if (highImpact) return "review_required";

  // The model can still escalate a borderline operational item to review.
  if (item.recommended_status === "review_required") return "review_required";

  return "auto_accepted";
}

let seq = 0;

// Deterministic-ish id: time-free so it doesn't depend on Date.now() in workflow
// contexts; uniqueness within a session comes from the incrementing counter.
function nextId(): string {
  seq += 1;
  return `ctx_${seq.toString().padStart(4, "0")}`;
}

export function materialize(
  suggested: SuggestedContextItem[],
  sourceAgent: string,
  createdAt: string,
  policy: ClassificationPolicy,
): ContextItem[] {
  return suggested.map((s) => ({
    id: nextId(),
    type: s.type,
    content: s.content,
    source_agent: sourceAgent,
    status: classifyStatus(s, policy),
    risk_level: s.risk_level,
    confidence: typeof s.confidence === "number" ? s.confidence : 0.5,
    applies_to: Array.isArray(s.applies_to) ? s.applies_to : [],
    reason: s.reason,
    metadata: s.metadata,
    domain_tags: s.domain_tags,
    created_at: createdAt,
  }));
}

// Generic seeding of context items from plain content strings (e.g. base "Context
// v0"). The caller supplies the opaque role list, type, risk and any domain payload.
export interface SeedOptions {
  appliesTo: string[];
  createdAt: string;
  type?: string;
  riskLevel?: RiskLevel;
  status?: ContextStatus;
  confidence?: number;
  sourceAgent?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  domainTags?: string[];
}

export function seedContextItems(contents: string[], opts: SeedOptions): ContextItem[] {
  return contents.map((content) => ({
    id: nextId(),
    type: opts.type ?? "constraint",
    content,
    source_agent: opts.sourceAgent ?? "base",
    status: opts.status ?? "auto_accepted",
    risk_level: opts.riskLevel ?? "medium",
    confidence: opts.confidence ?? 1,
    applies_to: opts.appliesTo,
    reason: opts.reason,
    metadata: opts.metadata,
    domain_tags: opts.domainTags,
    created_at: opts.createdAt,
  }));
}

// Exposed for tests / callers that need to reset id sequencing deterministically.
export function __resetSeq(): void {
  seq = 0;
}
