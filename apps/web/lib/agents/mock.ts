// Mock / fixture mode — first-class, zero API spend.
//
// When AS_MOCK=1 (server) or NEXT_PUBLIC_AS_MOCK=1 (client), every agent returns a
// deterministic fixture instead of calling the model. The gate fixture is chosen by
// DCL_GATE_MOCK_VERDICT so the loop guard and force-pass are deterministically
// testable. Fixtures are valid against the same parsers real outputs use, so a mock
// run renders a real PDF end to end.
//
// This module only imports JSON, so it is safe to import from both the server
// workers and the client orchestrator (no secrets, no sockets).

import research from "./fixtures/research.json";
import writer from "./fixtures/writer.json";
import critic from "./fixtures/critic.json";
import architect from "./fixtures/architect.json";
import revise from "./fixtures/revise.json";
import qa from "./fixtures/qa.json";
import finalqaPass from "./fixtures/finalqa-pass.json";
import finalqaMinor from "./fixtures/finalqa-minor.json";
import finalqaFail from "./fixtures/finalqa-fail.json";

export interface MockMeta {
  agentName: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface MockResult {
  data: unknown;
  meta: MockMeta;
}

// Fixture kinds keyed by the pipeline stage that produces them.
export type FixtureKind = "research" | "writer" | "critic" | "architect" | "revise" | "qa";

const FIXTURES: Record<FixtureKind, unknown> = {
  research,
  writer,
  critic,
  architect,
  revise,
  qa,
};

function meta(agentName: string): MockMeta {
  return { agentName, durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

// True when the SERVER worker short-circuit should fire.
export function serverMockEnabled(): boolean {
  return process.env.AS_MOCK === "1";
}

// Raw fixture accessors — usable from the client with any enable check the caller wants.
export function getFixture(kind: FixtureKind): unknown {
  return FIXTURES[kind];
}

export function getFinalQaFixture(verdict?: string): unknown {
  switch ((verdict ?? "pass").toLowerCase()) {
    case "fail":
      return finalqaFail;
    case "pass_with_minor_fixes":
      return finalqaMinor;
    case "pass":
    default:
      return finalqaPass;
  }
}

// Server worker short-circuit: return the fixture for `kind` when AS_MOCK=1, else null.
export function maybeMock(kind: FixtureKind): MockResult | null {
  if (!serverMockEnabled()) return null;
  return { data: FIXTURES[kind], meta: meta(kind) };
}

// Gate worker short-circuit: pick the fixture by DCL_GATE_MOCK_VERDICT (default "pass").
export function maybeMockFinalQa(): MockResult | null {
  if (!serverMockEnabled()) return null;
  return { data: getFinalQaFixture(process.env.DCL_GATE_MOCK_VERDICT), meta: meta("final_qa") };
}
