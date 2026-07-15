-- 004_dcl_store.sql
--
-- Dynamic Context Layer (DCL) Context Store — durability + audit trail (write-only
-- in Phase 1). Four tables mirror the generic vocabulary declared in lib/dcl/types.ts
-- (ContextItem, AgentRun, Artifact, ContextSnapshot). Prefix as_dcl_ matches the
-- existing as_ convention (as_generation_jobs, as_used_payments).
--
-- Every table carries generation_id (the Phase 2 cross-session retrieval key), an
-- opaque metadata jsonb, and domain_tags text[]. NO domain-specific columns —
-- application data rides in metadata / domain_tags only, so the schema stays generic.

create table if not exists as_dcl_context_items (
  id            text not null,                    -- the ctx_NNNN id from classify.ts (unique per generation)
  generation_id uuid not null,
  type          text not null,
  content       text not null,
  source_agent  text not null,
  status        text not null,
  risk_level    text not null,
  confidence    double precision not null default 0.5,
  applies_to    text[] not null default '{}',
  reason        text,
  metadata      jsonb,
  domain_tags   text[] not null default '{}',
  created_at    timestamptz not null default now(),
  -- Compound PK: classify.ts mints short ctx_NNNN ids that reset per generation, so
  -- id alone is not globally unique. (generation_id, id) keeps the in-app id untouched.
  primary key (generation_id, id)
);
create index if not exists idx_dcl_items_gen on as_dcl_context_items (generation_id);

create table if not exists as_dcl_agent_runs (
  id                  uuid primary key default gen_random_uuid(),
  generation_id       uuid not null,
  agent_role          text not null,
  status              text not null,
  context_package_id  text,
  output_artifact_id  text,
  metadata            jsonb,
  domain_tags         text[] not null default '{}',
  created_at          timestamptz not null default now()
);
create index if not exists idx_dcl_runs_gen on as_dcl_agent_runs (generation_id);

create table if not exists as_dcl_artifacts (
  id            uuid primary key default gen_random_uuid(),
  generation_id uuid not null,
  content       jsonb not null,                   -- opaque (document json, gate judgment, etc.)
  metadata      jsonb,
  domain_tags   text[] not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists idx_dcl_artifacts_gen on as_dcl_artifacts (generation_id);

create table if not exists as_dcl_context_snapshots (
  id               uuid primary key default gen_random_uuid(),
  generation_id    uuid not null,
  version          integer not null,
  stage            text not null,                 -- opaque stage label, e.g. agent role or "seed"/"gate"
  context_item_ids text[] not null default '{}',
  metadata         jsonb,
  domain_tags      text[] not null default '{}',
  created_at       timestamptz not null default now()
);
create index if not exists idx_dcl_snapshots_gen on as_dcl_context_snapshots (generation_id);
