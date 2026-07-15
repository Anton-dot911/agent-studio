// Unit tests for the generic gate loop policy (pure, no network).
//
// Run with the repo's native test runner:  node --test lib/dcl/gates/gate.test.ts
// Imports use explicit .ts extensions and gate.ts has only type-only cross-module
// imports (erased at runtime), so these run with zero dependencies / no bundler.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideGateAction } from "./gate.ts";
import type { GateJudgment } from "./types.ts";

function judgment(verdict: GateJudgment["verdict"]): GateJudgment {
  return { verdict, findings: [], summary: `verdict=${verdict}` };
}

const policy = { maxCycles: 2 };

test("pass at cycle 0 -> deliver, not force-passed", () => {
  const d = decideGateAction(judgment("pass"), 0, policy);
  assert.equal(d.action, "deliver");
  assert.equal(d.forcePassed, false);
  assert.equal(d.cycle, 0);
});

test("pass_with_minor_fixes at cycle 0 -> deliver_with_warning, not force-passed", () => {
  const d = decideGateAction(judgment("pass_with_minor_fixes"), 0, policy);
  assert.equal(d.action, "deliver_with_warning");
  assert.equal(d.forcePassed, false);
});

test("pass_with_minor_fixes at/after cap -> still deliver_with_warning, not force-passed", () => {
  const d = decideGateAction(judgment("pass_with_minor_fixes"), 2, policy);
  assert.equal(d.action, "deliver_with_warning");
  assert.equal(d.forcePassed, false);
});

test("fail at cycle 0 with maxCycles=2 -> revise", () => {
  const d = decideGateAction(judgment("fail"), 0, policy);
  assert.equal(d.action, "revise");
  assert.equal(d.forcePassed, false);
});

test("fail at cycle 1 with maxCycles=2 -> revise", () => {
  const d = decideGateAction(judgment("fail"), 1, policy);
  assert.equal(d.action, "revise");
  assert.equal(d.forcePassed, false);
});

test("fail at cycle 2 with maxCycles=2 -> deliver_with_warning, force-passed (loop terminates)", () => {
  const d = decideGateAction(judgment("fail"), 2, policy);
  assert.equal(d.action, "deliver_with_warning");
  assert.equal(d.forcePassed, true);
});

test("total termination: fail never returns 'revise' once cycle >= maxCycles", () => {
  for (let cycle = policy.maxCycles; cycle < policy.maxCycles + 20; cycle++) {
    const d = decideGateAction(judgment("fail"), cycle, policy);
    assert.notEqual(d.action, "revise");
    assert.equal(d.action, "deliver_with_warning");
    assert.equal(d.forcePassed, true);
  }
});
