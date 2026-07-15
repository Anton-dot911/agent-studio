// Generation-job persistence helpers (Supabase table `as_generation_jobs`).
//
// A job represents one long-running Writer or Reviser run executed by the Netlify
// Background Function. The client creates a job, the worker fills it in, and the
// client polls until status is "done" or "error".

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const JOBS_TABLE = "as_generation_jobs";

export type JobKind = "writer" | "revise" | "critic" | "research" | "architect" | "final_qa";
export type JobStatus = "pending" | "running" | "done" | "error";

export interface GenerationJob {
  id: string;
  kind: JobKind;
  status: JobStatus;
  input: unknown;
  output: unknown | null;
  meta: unknown | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// Server-side Supabase client using the service-role key. Never import this from
// client components — the service-role key must stay on the server.
export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase env not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
