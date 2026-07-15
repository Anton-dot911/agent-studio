// DCL Context Store — generic core interface + in-memory implementation.
//
// This module is DOMAIN-AGNOSTIC and INFRA-AGNOSTIC. It defines the ContextStore
// interface in terms of the generic entities already declared in ./types
// (ContextItem, AgentRun, Artifact, ContextSnapshot) and ships a trivial Map-backed
// implementation used by tests and mock mode. It MUST NOT import any concrete
// backend (no REST client, no external service) or any application module.
//
// Phase 1 scope: durability + write path only. The cross-session read path
// (loadLatest) is declared but intentionally not implemented — the grouping key
// (generationId) already lets Phase 2 add reads WITHOUT a schema change.

import type { AgentRun, Artifact, ContextItem, ContextSnapshot } from "./types";

// A batch of writes for one generation. Any subset may be present.
export interface PersistBatch {
  items?: ContextItem[];
  run?: AgentRun;
  artifact?: Artifact;
  snapshot?: ContextSnapshot;
}

export interface ContextStore {
  saveContextItems(generationId: string, items: ContextItem[]): Promise<void>;
  appendAgentRun(generationId: string, run: AgentRun): Promise<void>;
  saveArtifact(generationId: string, artifact: Artifact): Promise<string>; // returns artifact id
  saveSnapshot(generationId: string, snapshot: ContextSnapshot): Promise<void>;
  // Phase 2 (declared now, not implemented in Phase 1):
  //   loadLatest(generationId: string): Promise<...>
}

// Generic glue: write whatever subset of a batch was provided. Domain-agnostic and
// dependency-injected (the caller supplies the store), so a persist route is a thin
// wrapper over this and it is trivially unit-testable with the in-memory store.
export async function writeBatch(
  store: ContextStore,
  generationId: string,
  batch: PersistBatch,
): Promise<{ artifactId?: string }> {
  let artifactId: string | undefined;
  if (batch.items && batch.items.length > 0) {
    await store.saveContextItems(generationId, batch.items);
  }
  if (batch.run) {
    await store.appendAgentRun(generationId, batch.run);
  }
  if (batch.artifact) {
    artifactId = await store.saveArtifact(generationId, batch.artifact);
  }
  if (batch.snapshot) {
    await store.saveSnapshot(generationId, batch.snapshot);
  }
  return { artifactId };
}

// Map-backed implementation, grouped by generationId. Used by tests and mock mode.
export class InMemoryContextStore implements ContextStore {
  readonly items = new Map<string, ContextItem[]>();
  readonly runs = new Map<string, AgentRun[]>();
  readonly artifacts = new Map<string, Artifact[]>();
  readonly snapshots = new Map<string, ContextSnapshot[]>();

  private push<T>(map: Map<string, T[]>, key: string, value: T): void {
    const existing = map.get(key);
    if (existing) existing.push(value);
    else map.set(key, [value]);
  }

  async saveContextItems(generationId: string, items: ContextItem[]): Promise<void> {
    for (const item of items) this.push(this.items, generationId, item);
  }

  async appendAgentRun(generationId: string, run: AgentRun): Promise<void> {
    this.push(this.runs, generationId, run);
  }

  async saveArtifact(generationId: string, artifact: Artifact): Promise<string> {
    this.push(this.artifacts, generationId, artifact);
    return artifact.id;
  }

  async saveSnapshot(generationId: string, snapshot: ContextSnapshot): Promise<void> {
    this.push(this.snapshots, generationId, snapshot);
  }
}
