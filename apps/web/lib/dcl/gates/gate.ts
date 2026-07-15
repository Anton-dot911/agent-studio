// DCL gate — generic loop policy.
//
// ONE pure function. No async, no fetch, no model, no I/O. Given a judgment, the
// current cycle count, and a policy, it returns the deterministic action to take.
// This is the single unit under test in gate.test.ts and the guarantee that the
// gate -> revise -> gate loop always terminates.
//
// Decision table (cycle is 0-based; maxCycles is the FAIL->revise cap):
//
//   verdict                | cycle < maxCycles           | cycle >= maxCycles
//   -----------------------|-----------------------------|-------------------------------
//   pass                   | deliver                     | deliver
//   pass_with_minor_fixes  | deliver_with_warning        | deliver_with_warning
//   fail                   | revise                      | deliver_with_warning (forcePassed)
//
// forcePassed is true ONLY in the bottom-right cell (fail at/after the cap): we
// deliver despite an unresolved FAIL so a paying caller is never blocked.

import type { GateAction, GateDecision, GateJudgment, GatePolicy } from "./types";

export function decideGateAction(
  judgment: GateJudgment,
  cycle: number,
  policy: GatePolicy,
): GateDecision {
  const atOrAfterCap = cycle >= policy.maxCycles;

  let action: GateAction;
  let forcePassed = false;

  switch (judgment.verdict) {
    case "pass":
      action = "deliver";
      break;
    case "pass_with_minor_fixes":
      // Always delivers; surfaces notes but never loops.
      action = "deliver_with_warning";
      break;
    case "fail":
    default:
      if (atOrAfterCap) {
        // Force-pass: deliver with a warning so the loop terminates.
        action = "deliver_with_warning";
        forcePassed = true;
      } else {
        action = "revise";
      }
      break;
  }

  return {
    verdict: judgment.verdict,
    action,
    forcePassed,
    cycle,
    findings: judgment.findings,
    summary: judgment.summary,
  };
}
