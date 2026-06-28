// DCL Context Package Builder.
//
// Before an agent runs, this assembles the role-relevant, validated subset of
// context items plus base project context, ranks and groups them, and renders a
// compact text block to inject into the agent prompt.
//
// Rules (from the implementation brief, section 10):
//   1. Drop rejected / archived / superseded items from FACTUAL sections.
//   2. Include accepted + auto_accepted items.
//   3. Include review_required items only for review agents — and always clearly
//      marked as "needs verification, do not treat as fact".
//   4. Filter by applies_to.
//   5. Rank by risk level, then confidence, then recency.
//   6. Group into sections. 7. Cap length. 8. Render.

import {
  DCL_MAX_CONTEXT_ITEMS_PER_PACKAGE,
  REVIEW_ROLES,
  type AgentRole,
  type BaseContext,
  type ContextItem,
  type ContextType,
} from "./types";

export interface ContextPackage {
  agentRole: AgentRole;
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

const SECTION_TYPES: Record<keyof Pick<ContextPackage,
  "relevantConstraints" | "acceptedDecisions" | "knownRisks" | "technicalGaps" | "openQuestions" | "reviewFindings">, ContextType[]> = {
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

export function buildContextPackage(
  base: BaseContext,
  items: ContextItem[],
  role: AgentRole,
): ContextPackage {
  const isReviewRole = REVIEW_ROLES.has(role);

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

  const pick = (key: keyof typeof SECTION_TYPES): ContextItem[] => {
    const types = SECTION_TYPES[key];
    return factual.filter((i) => types.includes(i.type)).sort(rank);
  };

  let pkg: ContextPackage = {
    agentRole: role,
    projectGoal: base.projectGoal,
    currentTask: TASK_BY_ROLE[role],
    relevantConstraints: pick("relevantConstraints"),
    acceptedDecisions: pick("acceptedDecisions"),
    knownRisks: pick("knownRisks"),
    technicalGaps: pick("technicalGaps"),
    openQuestions: pick("openQuestions"),
    reviewFindings: pick("reviewFindings"),
    flaggedForVerification: flagged.sort(rank),
    outputRequirements: base.outputRequirements,
    itemCount: 0,
  };

  pkg = capPackage(pkg, DCL_MAX_CONTEXT_ITEMS_PER_PACKAGE);
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
// agent prompt never bloats with empty headers.
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
// to inject (no base goal and no items), so callers can cheaply skip injection.
export function buildAndRender(base: BaseContext, items: ContextItem[], role: AgentRole): string {
  const pkg = buildContextPackage(base, items, role);
  if (pkg.itemCount === 0 && !pkg.projectGoal && pkg.outputRequirements.length === 0) return "";
  return renderContextPackage(pkg);
}

// Derive Context v0 (base context) from the raw intake form.
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
