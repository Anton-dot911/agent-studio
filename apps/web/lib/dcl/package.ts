// DCL Context Package Builder — generic core.
//
// Before an agent runs, this assembles the role-relevant, validated subset of
// context items plus caller-supplied project context, ranks and groups them, and
// renders a compact text block to inject into the agent prompt.
//
// Domain knowledge is injected via PackageContext (project goal, the current task
// text, output requirements) and PackageConfig (which opaque roles are "review"
// roles, and which opaque `type` strings fall into each generic section bucket).
// The core itself contains no roles, types, or domain vocabulary.

import {
  DCL_MAX_CONTEXT_ITEMS_PER_PACKAGE,
  type ContextItem,
} from "./types";

// Generic section buckets of a context package (presentation structure, not domain).
export type SectionKey =
  | "relevantConstraints"
  | "acceptedDecisions"
  | "knownRisks"
  | "technicalGaps"
  | "openQuestions"
  | "reviewFindings";

// Maps each generic bucket to the opaque `type` strings it collects (domain-supplied).
export type SectionTypeMap = Record<SectionKey, string[]>;

// Caller-supplied, already role-resolved project context for one package.
export interface PackageContext {
  projectGoal: string;
  currentTask: string;
  outputRequirements: string[];
}

// Caller-supplied domain configuration.
export interface PackageConfig {
  reviewRoles: ReadonlySet<string>;
  sectionTypes: SectionTypeMap;
  maxItems?: number;
}

export interface ContextPackage {
  agentRole: string;
  projectGoal: string;
  currentTask: string;
  relevantConstraints: ContextItem[];
  acceptedDecisions: ContextItem[];
  knownRisks: ContextItem[];
  technicalGaps: ContextItem[];
  openQuestions: ContextItem[];
  reviewFindings: ContextItem[];
  flaggedForVerification: ContextItem[];
  outputRequirements: string[];
  itemCount: number;
}

const RISK_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function rank(a: ContextItem, b: ContextItem): number {
  const r = (RISK_RANK[a.risk_level] ?? 9) - (RISK_RANK[b.risk_level] ?? 9);
  if (r !== 0) return r;
  return (b.confidence ?? 0) - (a.confidence ?? 0);
}

export function buildContextPackage(
  ctx: PackageContext,
  items: ContextItem[],
  role: string,
  config: PackageConfig,
): ContextPackage {
  const isReviewRole = config.reviewRoles.has(role);

  // Items that apply to this role and are usable as factual guidance.
  const applicable = items.filter(
    (i) => i.applies_to.length === 0 || i.applies_to.includes(role),
  );

  const factual = applicable.filter(
    (i) => i.status === "accepted" || i.status === "auto_accepted",
  );

  // review_required items are surfaced only to review agents, and only as flagged,
  // never as fact. Rejected / archived / superseded are excluded entirely.
  const flagged = isReviewRole
    ? applicable.filter((i) => i.status === "review_required")
    : [];

  const pick = (key: SectionKey): ContextItem[] => {
    const types = config.sectionTypes[key] ?? [];
    return factual.filter((i) => types.includes(i.type)).sort(rank);
  };

  let pkg: ContextPackage = {
    agentRole: role,
    projectGoal: ctx.projectGoal,
    currentTask: ctx.currentTask,
    relevantConstraints: pick("relevantConstraints"),
    acceptedDecisions: pick("acceptedDecisions"),
    knownRisks: pick("knownRisks"),
    technicalGaps: pick("technicalGaps"),
    openQuestions: pick("openQuestions"),
    reviewFindings: pick("reviewFindings"),
    flaggedForVerification: flagged.sort(rank),
    outputRequirements: ctx.outputRequirements,
    itemCount: 0,
  };

  pkg = capPackage(pkg, config.maxItems ?? DCL_MAX_CONTEXT_ITEMS_PER_PACKAGE);
  pkg.itemCount = countItems(pkg);
  return pkg;
}

function countItems(p: ContextPackage): number {
  return (
    p.relevantConstraints.length +
    p.acceptedDecisions.length +
    p.knownRisks.length +
    p.technicalGaps.length +
    p.openQuestions.length +
    p.reviewFindings.length +
    p.flaggedForVerification.length
  );
}

// Keep the highest-priority items if the package exceeds the cap. Risk-bearing
// sections are preserved first; low-signal sections are trimmed first.
function capPackage(p: ContextPackage, max: number): ContextPackage {
  if (countItems(p) <= max) return p;
  const order: (keyof ContextPackage)[] = [
    "openQuestions",
    "reviewFindings",
    "technicalGaps",
    "acceptedDecisions",
    "knownRisks",
    "relevantConstraints",
    "flaggedForVerification",
  ];
  // Trim from the least critical section forward until under cap.
  for (const key of order) {
    while (countItems(p) > max && (p[key] as ContextItem[]).length > 0) {
      (p[key] as ContextItem[]).pop();
    }
    if (countItems(p) <= max) break;
  }
  return p;
}

// Render the package as a compact prompt section. Empty sections are omitted so the
// agent prompt never bloats with empty headers. The section titles are generic
// presentation labels, not domain vocabulary.
export function renderContextPackage(p: ContextPackage): string {
  const lines: string[] = [];
  lines.push("## Dynamic Context Package");
  lines.push("");
  lines.push(
    "Use the following validated project context as operational guidance. " +
      "Preserve accepted constraints and decisions. Do NOT treat flagged or " +
      "unverified items as established facts. If you identify new decisions, risks, " +
      "assumptions, contradictions, or missing details, make them explicit in your output.",
  );
  lines.push("");
  lines.push(`Project Goal: ${p.projectGoal || "(not specified)"}`);
  lines.push(`Current Task: ${p.currentTask}`);

  const section = (title: string, items: ContextItem[]) => {
    if (items.length === 0) return;
    lines.push("");
    lines.push(`### ${title}`);
    for (const i of items) {
      lines.push(`- [${i.risk_level}] ${i.content}${i.source_agent !== "base" ? ` (via ${i.source_agent})` : ""}`);
    }
  };

  section("Relevant Constraints", p.relevantConstraints);
  section("Accepted Decisions & Assumptions", p.acceptedDecisions);
  section("Known Risks & Claims to Verify", p.knownRisks);
  section("Technical Gaps & Source Requirements", p.technicalGaps);
  section("Open Questions", p.openQuestions);
  section("Prior Review Findings", p.reviewFindings);

  if (p.flaggedForVerification.length > 0) {
    lines.push("");
    lines.push("### Flagged — Needs Verification (do NOT treat as fact)");
    for (const i of p.flaggedForVerification) {
      lines.push(`- [${i.risk_level}] ${i.content}${i.reason ? ` — ${i.reason}` : ""}`);
    }
  }

  if (p.outputRequirements.length > 0) {
    lines.push("");
    lines.push("### Output Requirements");
    for (const r of p.outputRequirements) lines.push(`- ${r}`);
  }

  return lines.join("\n");
}

// Convenience: build + render in one call. Returns "" when there is nothing useful
// to inject (no goal, no items, no output requirements), so callers can skip cheaply.
export function buildAndRender(
  ctx: PackageContext,
  items: ContextItem[],
  role: string,
  config: PackageConfig,
): string {
  const pkg = buildContextPackage(ctx, items, role, config);
  if (pkg.itemCount === 0 && !pkg.projectGoal && pkg.outputRequirements.length === 0) return "";
  return renderContextPackage(pkg);
}
