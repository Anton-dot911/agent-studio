// DCL gate — generic core types.
//
// This module is DOMAIN-AGNOSTIC and MODEL-AGNOSTIC. It defines the shapes of a
// judgment (produced by an injected evaluator/worker), a loop policy, and the
// deterministic decision derived from them. It knows nothing about any specific
// application, its documents, its review criteria, or which model produced the
// judgment. All such knowledge lives on the adapter side.

import type { RiskLevel } from "../types";

// The three verdicts a judgment can carry.
export type GateVerdict = "pass" | "pass_with_minor_fixes" | "fail";

// What the loop policy tells the orchestrator to do next.
export type GateAction = "deliver" | "deliver_with_warning" | "revise";

// One actionable issue the judge raised. Opaque to the core beyond these fields.
export interface GateFinding {
  severity: RiskLevel;        // reuse RiskLevel from ../types
  message: string;
  applies_to?: string[];      // opaque role/section labels, never enumerated by the core
}

// Raw judgment returned by the (injected) evaluator / worker.
export interface GateJudgment {
  verdict: GateVerdict;
  findings: GateFinding[];
  summary: string;
}

// Loop policy configuration (the domain supplies the numbers).
export interface GatePolicy {
  maxCycles: number;          // default 2; after this many FAILs we force-pass
}

// Deterministic decision derived from a judgment + the current cycle.
export interface GateDecision {
  verdict: GateVerdict;
  action: GateAction;
  forcePassed: boolean;       // true when we deliver despite an unresolved FAIL at the cap
  cycle: number;              // 0-based index of the gate run that produced this decision
  findings: GateFinding[];
  summary: string;
}
