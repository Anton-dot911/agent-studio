// Use direct Supabase REST API calls (no @supabase/supabase-js client) to avoid the
// WebSocket initialisation that @supabase/realtime-js performs at createClient() time.
// That initialisation crashes on Node.js < 22 because there is no built-in WebSocket,
// and Netlify Lambda functions run on Node.js 20 regardless of NODE_VERSION in netlify.toml.
import {
  generateWriter,
  generateRevise,
  type WriterInput,
  type ReviseInput,
} from "../../lib/agents/generate";
import { generateCritic, type CriticInput } from "../../lib/agents/critic";
import { generateResearch, type ResearchInput } from "../../lib/agents/research";
import { generateArchitect, type ArchitectInput } from "../../lib/agents/architect";

const JOBS_TABLE = "as_generation_jobs";

// Minimal REST helpers — all Supabase REST calls are just fetch under the hood.
async function sbSelect(url: string, key: string, table: string, id: string) {
  const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}&select=id,kind,status,input&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) return { data: null, error: `${res.status} ${await res.text()}` };
  const rows = (await res.json()) as Record<string, unknown>[];
  return { data: rows[0] ?? null, error: null };
}

async function sbUpdate(url: string, key: string, table: string, id: string, patch: Record<string, unknown>) {
  const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return `${res.status} ${await res.text()}`;
  return null;
}

export default async (req: Request) => {
  let jobId: string | undefined;
  try {
    const body = (await req.json()) as { jobId?: string };
    jobId = body.jobId;
  } catch {
    console.error("[bg] Failed to parse request body");
    return new Response("Invalid body", { status: 400 });
  }
  if (!jobId) {
    console.error("[bg] No jobId in request");
    return new Response("jobId required", { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!supabaseUrl || !serviceKey || !apiKey) {
    console.error("[bg] Missing env vars — url:", !!supabaseUrl, "serviceKey:", !!serviceKey, "apiKey:", !!apiKey);
    return new Response("Server not configured", { status: 500 });
  }

  try {
    console.log("[bg] Loading job", jobId);
    const { data: job, error: loadErr } = await sbSelect(supabaseUrl, serviceKey, JOBS_TABLE, jobId);
    if (loadErr || !job) {
      console.error("[bg] Job not found:", loadErr ?? "no data");
      return new Response("Job not found", { status: 404 });
    }

    console.log("[bg] Setting job to running, kind =", job.kind);
    const runningErr = await sbUpdate(supabaseUrl, serviceKey, JOBS_TABLE, jobId, {
      status: "running",
      updated_at: new Date().toISOString(),
    });
    if (runningErr) console.error("[bg] Failed to set running:", runningErr);

    console.log("[bg] Starting generation, kind =", job.kind);
    let result;
    if (job.kind === "writer") {
      result = await generateWriter(apiKey, job.input as WriterInput);
    } else if (job.kind === "critic") {
      result = await generateCritic(apiKey, job.input as CriticInput);
    } else if (job.kind === "research") {
      result = await generateResearch(apiKey, job.input as ResearchInput);
    } else if (job.kind === "architect") {
      result = await generateArchitect(apiKey, job.input as ArchitectInput);
    } else {
      result = await generateRevise(apiKey, job.input as ReviseInput);
    }

    console.log("[bg] Generation complete, writing result");
    const doneErr = await sbUpdate(supabaseUrl, serviceKey, JOBS_TABLE, jobId, {
      status: "done",
      output: result.data,
      meta: result.meta,
      updated_at: new Date().toISOString(),
    });

    if (doneErr) {
      console.error("[bg] Failed to write done result:", doneErr);
      await sbUpdate(supabaseUrl, serviceKey, JOBS_TABLE, jobId, {
        status: "error",
        error: `DB write failed: ${doneErr}`,
        updated_at: new Date().toISOString(),
      });
      return new Response("db-error", { status: 200 });
    }

    console.log("[bg] Job", jobId, "completed successfully");
    return new Response("ok", { status: 200 });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Generation failed";
    console.error("[bg] Unhandled error for job", jobId, ":", errorMsg);
    await sbUpdate(supabaseUrl, serviceKey, JOBS_TABLE, jobId, {
      status: "error",
      error: errorMsg,
      updated_at: new Date().toISOString(),
    });
    return new Response("error", { status: 200 });
  }
};
