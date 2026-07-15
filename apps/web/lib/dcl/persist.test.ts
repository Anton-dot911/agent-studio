// Persist-path test (pure, no network, no Next.js).
//
// The /api/dcl/persist route is a thin wrapper: parse a JSON batch body -> pick a
// store -> writeBatch. Importing the real route pulls in next/server, which is not
// available under the native test runner, so this test exercises the exact same
// core flow (JSON body -> InMemoryContextStore via writeBatch) that the route runs
// when DCL_STORE=memory. Asserts ok + that the in-memory store received the batch.
//
// Run: node --test lib/dcl/persist.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryContextStore, writeBatch, type PersistBatch } from "./store.ts";

// Mirror the route's core: parse a batch and write it to an injected store.
async function handlePersist(
  store: InMemoryContextStore,
  rawBody: string,
): Promise<{ ok: boolean; artifactId?: string; error?: string }> {
  let body: PersistBatch & { generationId?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }
  const { generationId, items, run, artifact, snapshot } = body;
  if (!generationId) return { ok: false, error: "generationId is required" };
  const { artifactId } = await writeBatch(store, generationId, { items, run, artifact, snapshot });
  return { ok: true, artifactId };
}

test("persist a batch (DCL_STORE=memory equivalent): ok + store received it", async () => {
  const store = new InMemoryContextStore();
  const generationId = "11111111-1111-1111-1111-111111111111";

  const rawBody = JSON.stringify({
    generationId,
    items: [
      {
        id: "ctx_0001",
        type: "constraint",
        content: "Stay within budget",
        source_agent: "base",
        status: "auto_accepted",
        risk_level: "medium",
        confidence: 1,
        applies_to: [],
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    snapshot: {
      id: "snap-seed",
      version: 0,
      stage: "seed",
      context_item_ids: ["ctx_0001"],
      created_at: "2026-01-01T00:00:00.000Z",
    },
  });

  const res = await handlePersist(store, rawBody);
  assert.equal(res.ok, true);
  assert.equal(store.items.get(generationId)?.length, 1);
  assert.equal(store.snapshots.get(generationId)?.[0].stage, "seed");
});

test("persist rejects a body with no generationId", async () => {
  const store = new InMemoryContextStore();
  const res = await handlePersist(store, JSON.stringify({ items: [] }));
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /generationId/);
});
