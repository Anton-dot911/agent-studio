// DCL Context Store persistence route (server-side).
//
// The browser orchestrator cannot hold the service-role key, so all durability
// writes go through this route. It accepts a batch (any subset of items / run /
// artifact / snapshot) for one generationId, selects the store (Supabase by
// default, in-memory when DCL_STORE=memory), and writes what was provided.
//
// Durability is best-effort in Phase 1: a failure here MUST NOT break generation.
// The orchestrator treats a non-ok response as non-fatal and continues, so a paying
// client still gets the document even if persistence is misconfigured or down.

import { NextRequest, NextResponse } from "next/server";
import { writeBatch, type PersistBatch } from "../../../../lib/dcl/store";
import { createContextStore } from "../../../../lib/dcl-store-supabase";

interface PersistBody extends PersistBatch {
  generationId?: string;
}

export async function POST(req: NextRequest) {
  let body: PersistBody;
  try {
    body = (await req.json()) as PersistBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { generationId, items, run, artifact, snapshot } = body;
  if (!generationId || typeof generationId !== "string") {
    return NextResponse.json({ ok: false, error: "generationId is required" }, { status: 400 });
  }

  try {
    const store = createContextStore();
    const { artifactId } = await writeBatch(store, generationId, { items, run, artifact, snapshot });
    return NextResponse.json({ ok: true, artifactId });
  } catch (e) {
    // Non-fatal: report the error but keep the status 200 so the orchestrator's
    // best-effort persist call resolves without throwing and generation continues.
    console.error("[dcl/persist] write failed:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Persist failed" },
      { status: 200 },
    );
  }
}
