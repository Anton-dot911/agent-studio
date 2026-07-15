// Supabase-backed ContextStore (adapter / infra side — deliberately OUTSIDE lib/dcl/).
//
// This is the only place that knows the as_dcl_* table names and the Supabase REST
// shape. It implements the generic ContextStore interface from lib/dcl/store using
// the SAME direct REST (fetch) pattern as netlify/functions/generate-background.ts —
// NOT @supabase/supabase-js, whose realtime WebSocket init crashes on Node 20.
//
// It reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Because the core
// stays pure, this file (and its env/table knowledge) is what keeps lib/dcl/ clean.

import {
  InMemoryContextStore,
  type ContextStore,
} from "./dcl/store";
import type { AgentRun, Artifact, ContextItem, ContextSnapshot } from "./dcl/types";

const ITEMS_TABLE = "as_dcl_context_items";
const RUNS_TABLE = "as_dcl_agent_runs";
const ARTIFACTS_TABLE = "as_dcl_artifacts";
const SNAPSHOTS_TABLE = "as_dcl_context_snapshots";

interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

function readConfig(): SupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Context Store (Supabase) not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return { url, serviceKey };
}

export class SupabaseContextStore implements ContextStore {
  private readonly cfg: SupabaseConfig;

  constructor(cfg: SupabaseConfig = readConfig()) {
    this.cfg = cfg;
  }

  // Generic REST insert. `onConflict` triggers an upsert on the given columns.
  private async insert(
    table: string,
    rows: Record<string, unknown>[],
    onConflict?: string,
  ): Promise<void> {
    if (rows.length === 0) return;
    const qs = onConflict ? `?on_conflict=${onConflict}` : "";
    const res = await fetch(`${this.cfg.url}/rest/v1/${table}${qs}`, {
      method: "POST",
      headers: {
        apikey: this.cfg.serviceKey,
        Authorization: `Bearer ${this.cfg.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: onConflict ? "return=minimal,resolution=merge-duplicates" : "return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      throw new Error(`Context Store write failed (${table}): ${res.status} ${await res.text()}`);
    }
  }

  async saveContextItems(generationId: string, items: ContextItem[]): Promise<void> {
    const rows = items.map((i) => ({
      id: i.id,
      generation_id: generationId,
      type: i.type,
      content: i.content,
      source_agent: i.source_agent,
      status: i.status,
      risk_level: i.risk_level,
      confidence: i.confidence,
      applies_to: i.applies_to,
      reason: i.reason ?? null,
      metadata: i.metadata ?? null,
      domain_tags: i.domain_tags ?? [],
      created_at: i.created_at,
    }));
    // Compound PK (generation_id, id) -> upsert so re-persisting a stage is idempotent.
    await this.insert(ITEMS_TABLE, rows, "generation_id,id");
  }

  async appendAgentRun(generationId: string, run: AgentRun): Promise<void> {
    await this.insert(RUNS_TABLE, [
      {
        id: run.id,
        generation_id: generationId,
        agent_role: run.agent_role,
        status: run.status,
        context_package_id: run.context_package_id ?? null,
        output_artifact_id: run.output_artifact_id ?? null,
        metadata: run.metadata ?? null,
        domain_tags: run.domain_tags ?? [],
        created_at: run.created_at,
      },
    ]);
  }

  async saveArtifact(generationId: string, artifact: Artifact): Promise<string> {
    await this.insert(ARTIFACTS_TABLE, [
      {
        id: artifact.id,
        generation_id: generationId,
        content: artifact.content,
        metadata: artifact.metadata ?? null,
        domain_tags: artifact.domain_tags ?? [],
        created_at: artifact.created_at,
      },
    ]);
    return artifact.id;
  }

  async saveSnapshot(generationId: string, snapshot: ContextSnapshot): Promise<void> {
    await this.insert(SNAPSHOTS_TABLE, [
      {
        id: snapshot.id,
        generation_id: generationId,
        version: snapshot.version,
        stage: snapshot.stage,
        context_item_ids: snapshot.context_item_ids,
        metadata: snapshot.metadata ?? null,
        domain_tags: snapshot.domain_tags ?? [],
        created_at: snapshot.created_at,
      },
    ]);
  }
}

// Store factory: DCL_STORE=memory selects the in-memory store (no Supabase creds
// needed at all — used by mock mode and local/offline runs); otherwise Supabase.
export function createContextStore(): ContextStore {
  if ((process.env.DCL_STORE ?? "supabase").toLowerCase() === "memory") {
    return getSharedMemoryStore();
  }
  return new SupabaseContextStore();
}

// A single process-wide in-memory store, so DCL_STORE=memory persists across
// requests within one server process (lets a mock E2E inspect what was written).
let sharedMemoryStore: InMemoryContextStore | null = null;
export function getSharedMemoryStore(): InMemoryContextStore {
  if (!sharedMemoryStore) sharedMemoryStore = new InMemoryContextStore();
  return sharedMemoryStore;
}
