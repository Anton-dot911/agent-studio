-- supabase/migrations/001_agent_studio.sql
-- Agent Studio tables — prefix "as_" to avoid conflicts with existing AgentVault+ tables

-- Клієнти
CREATE TABLE IF NOT EXISTS as_clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  platform    TEXT DEFAULT 'direct', -- 'upwork' | 'fiverr' | 'farcaster' | 'direct'
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Проєкти (кожне замовлення)
CREATE TABLE IF NOT EXISTS as_projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID REFERENCES as_clients(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  doc_type     TEXT NOT NULL DEFAULT 'tech_spec', -- 'tech_spec' | 'tokenomics' | 'defi_audit'
  status       TEXT NOT NULL DEFAULT 'pending',
  -- pending → researching → writing → reviewing → ready → delivered → archived
  intake_data  JSONB,         -- відповіді intake форми (IntakeFormData)
  price_usd    NUMERIC(10,2),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

-- Запуски агентів (кожен крок pipeline)
CREATE TABLE IF NOT EXISTS as_agent_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID REFERENCES as_projects(id) ON DELETE CASCADE,
  agent_name   TEXT NOT NULL, -- 'research' | 'writer' | 'qa' | 'delivery' | 'orchestrator'
  status       TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
  input_data   JSONB,
  output_data  JSONB,
  tokens_in    INTEGER DEFAULT 0,
  tokens_out   INTEGER DEFAULT 0,
  cost_usd     NUMERIC(8,6) DEFAULT 0,
  duration_ms  INTEGER DEFAULT 0,
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Документи з векторними embeddings (для semantic memory — Phase 2)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS as_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID REFERENCES as_projects(id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES as_agent_runs(id) ON DELETE SET NULL,
  doc_type     TEXT NOT NULL,
  content      TEXT NOT NULL,
  embedding    vector(1536),  -- text-embedding-3-small (Phase 2)
  metadata     JSONB DEFAULT '{}', -- sector, blockchain, keywords, etc.
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_as_projects_status     ON as_projects (status);
CREATE INDEX IF NOT EXISTS idx_as_projects_client     ON as_projects (client_id);
CREATE INDEX IF NOT EXISTS idx_as_agent_runs_project  ON as_agent_runs (project_id);
CREATE INDEX IF NOT EXISTS idx_as_agent_runs_agent    ON as_agent_runs (agent_name, status);
CREATE INDEX IF NOT EXISTS idx_as_documents_project   ON as_documents (project_id);

-- Vector index (активувати після появи перших документів — Phase 2)
-- CREATE INDEX ON as_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─── Semantic search function (Phase 2) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION match_as_documents (
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.75,
  match_count     int DEFAULT 3
)
RETURNS TABLE (
  id          UUID,
  content     TEXT,
  metadata    JSONB,
  similarity  float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM as_documents d
  WHERE 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ─── Auto-update updated_at ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER as_projects_updated_at
  BEFORE UPDATE ON as_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS (Row Level Security) — базова конфігурація ─────────────────────────
-- Для Phase 1 вимикаємо RLS (серверні запити через service_role key)
-- В Phase 2 включимо з proper user auth

ALTER TABLE as_clients   DISABLE ROW LEVEL SECURITY;
ALTER TABLE as_projects  DISABLE ROW LEVEL SECURITY;
ALTER TABLE as_agent_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE as_documents  DISABLE ROW LEVEL SECURITY;
