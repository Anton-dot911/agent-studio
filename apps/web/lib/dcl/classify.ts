// DCL hybrid review logic.
//
// Turns a raw SuggestedContextItem (from the Context Extractor) into a stored
// ContextItem with a final status, using deterministic rules so the behaviour is
// predictable and testable — the model's `recommended_status` is only a secondary
// signal, never the sole authority.
//
// Policy (per product decision "auto-accept + flag", no manual gates):
//   - Unsupported / speculative / hallucinated  → rejected
//   - High-impact type OR high/critical risk     → review_required (flagged, still
//     passed forward to review agents but never treated as fact)
//   - Everything else low-risk & operational     → auto_accepted

import {
  HIGH_IMPACT_TYPES,
  type BaseContext,
  type ContextItem,
  type ContextStatus,
  type SuggestedContextItem,
} from "./types";

export function classifyStatus(item: SuggestedContextItem): ContextStatus {
  if (item.recommended_status === "rejected_or_needs_source") return "rejected";

  const highImpact =
    HIGH_IMPACT_TYPES.has(item.type) ||
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
  sourceAgent: ContextItem["source_agent"],
  createdAt: string,
): ContextItem[] {
  return suggested.map((s) => ({
    id: nextId(),
    type: s.type,
    content: s.content,
    source_agent: sourceAgent,
    status: classifyStatus(s),
    risk_level: s.risk_level,
    confidence: typeof s.confidence === "number" ? s.confidence : 0.5,
    applies_to: Array.isArray(s.applies_to) ? s.applies_to : [],
    reason: s.reason,
    created_at: createdAt,
  }));
}

// Seed Context v0 items from base project context. These are auto-accepted, apply
// to every downstream role, and never expire — they are the project's ground rules.
export function seedBaseContextItems(base: BaseContext, createdAt: string): ContextItem[] {
  const all: ContextItem["applies_to"] = [
    "research", "writer", "qa", "critic", "implementation_architect", "revise", "final_qa",
  ];
  return base.knownConstraints.map((content) => ({
    id: nextId(),
    type: "constraint" as const,
    content,
    source_agent: "base" as const,
    status: "auto_accepted" as const,
    risk_level: "medium" as const,
    confidence: 1,
    applies_to: all,
    reason: "Base project constraint from intake form.",
    created_at: createdAt,
  }));
}

// Exposed for tests / callers that need to reset id sequencing deterministically.
export function __resetSeq(): void {
  seq = 0;
}
