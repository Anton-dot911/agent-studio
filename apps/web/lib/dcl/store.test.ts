// Unit tests for the generic Context Store (pure, no network).
//
// Run: node --test lib/dcl/store.test.ts
// store.ts has only type-only cross-module imports (erased at runtime), so this
// runs with zero dependencies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryContextStore, writeBatch } from "./store.ts";
import type { AgentRun, Artifact, ContextItem, ContextSnapshot } from "./types.ts";

const gen = "gen-1";

function item(id: string): ContextItem {
  return {
    id,
    type: "constraint",
    content: `content ${id}`,
    source_agent: "base",
    status: "auto_accepted",
    risk_level: "medium",
    confidence: 1,
    applies_to: [],
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

test("InMemoryContextStore round-trip: items/run/artifact/snapshot are stored", async () => {
  const store = new InMemoryContextStore();

  await store.saveContextItems(gen, [item("ctx_0001"), item("ctx_0002")]);
  assert.equal(store.items.get(gen)?.length, 2);

  const run: AgentRun = {
    id: "run-1",
    agent_role: "final_qa",
    status: "pass",
    created_at: "2026-01-01T00:00:00.000Z",
  };
  await store.appendAgentRun(gen, run);
  assert.equal(store.runs.get(gen)?.[0].agent_role, "final_qa");

  const artifact: Artifact = {
    id: "art-1",
    content: { hello: "world" },
    created_at: "2026-01-01T00:00:00.000Z",
  };
  const returnedId = await store.saveArtifact(gen, artifact);
  assert.equal(returnedId, "art-1");
  assert.equal(store.artifacts.get(gen)?.length, 1);

  const snapshot: ContextSnapshot = {
    id: "snap-1",
    version: 0,
    stage: "seed",
    context_item_ids: ["ctx_0001", "ctx_0002"],
    created_at: "2026-01-01T00:00:00.000Z",
  };
  await store.saveSnapshot(gen, snapshot);
  assert.equal(store.snapshots.get(gen)?.[0].stage, "seed");
});

test("writeBatch writes only the subset provided", async () => {
  const store = new InMemoryContextStore();

  // Items + snapshot only (no run, no artifact).
  const res1 = await writeBatch(store, gen, {
    items: [item("ctx_0001")],
    snapshot: {
      id: "snap-1",
      version: 0,
      stage: "seed",
      context_item_ids: ["ctx_0001"],
      created_at: "2026-01-01T00:00:00.000Z",
    },
  });
  assert.equal(res1.artifactId, undefined);
  assert.equal(store.items.get(gen)?.length, 1);
  assert.equal(store.snapshots.get(gen)?.length, 1);
  assert.equal(store.runs.get(gen), undefined);
  assert.equal(store.artifacts.get(gen), undefined);

  // Run + artifact only; artifact id is echoed back.
  const res2 = await writeBatch(store, gen, {
    run: { id: "run-1", agent_role: "final_qa", status: "fail", created_at: "2026-01-01T00:00:00.000Z" },
    artifact: { id: "art-9", content: { verdict: "fail" }, created_at: "2026-01-01T00:00:00.000Z" },
  });
  assert.equal(res2.artifactId, "art-9");
  assert.equal(store.runs.get(gen)?.length, 1);
  assert.equal(store.artifacts.get(gen)?.length, 1);
});

test("writeBatch on an empty batch is a no-op", async () => {
  const store = new InMemoryContextStore();
  const res = await writeBatch(store, gen, {});
  assert.equal(res.artifactId, undefined);
  assert.equal(store.items.get(gen), undefined);
  assert.equal(store.snapshots.get(gen), undefined);
});
