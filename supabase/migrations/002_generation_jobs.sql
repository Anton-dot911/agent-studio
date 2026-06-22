-- supabase/migrations/002_generation_jobs.sql
-- Async generation jobs for the Writer/Reviser background worker.
-- The client creates a job, the Netlify Background Function fills it in, and the
-- client polls until status is 'done' or 'error'. This decouples long (Sonnet-quality)
-- document generation from the request timeout.

CREATE TABLE IF NOT EXISTS as_generation_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL,                       -- 'writer' | 'revise'
  status      TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'running' | 'done' | 'error'
  input       JSONB NOT NULL,
  output      JSONB,
  meta        JSONB,
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_as_generation_jobs_status ON as_generation_jobs (status);
CREATE INDEX IF NOT EXISTS idx_as_generation_jobs_created ON as_generation_jobs (created_at);

-- Phase 1: server-only access via service_role key.
ALTER TABLE as_generation_jobs DISABLE ROW LEVEL SECURITY;
