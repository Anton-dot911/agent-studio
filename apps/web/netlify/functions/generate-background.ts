import { createClient } from "@supabase/supabase-js";
import {
  generateWriter,
  generateRevise,
  type WriterInput,
  type ReviseInput,
} from "../../lib/agents/generate";

const JOBS_TABLE = "as_generation_jobs";

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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey || !apiKey) {
    console.error("[bg] Missing env vars — url:", !!url, "serviceKey:", !!serviceKey, "apiKey:", !!apiKey);
    return new Response("Server not configured", { status: 500 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    console.log("[bg] Loading job", jobId);
    const { data: job, error: loadErr } = await supabase
      .from(JOBS_TABLE)
      .select("id, kind, status, input")
      .eq("id", jobId)
      .single();

    if (loadErr || !job) {
      console.error("[bg] Job not found:", loadErr?.message ?? "no data");
      return new Response("Job not found", { status: 404 });
    }

    console.log("[bg] Setting job to running, kind =", job.kind);
    const { error: runningErr } = await supabase
      .from(JOBS_TABLE)
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (runningErr) console.error("[bg] Failed to set running:", runningErr.message);

    console.log("[bg] Starting generation...");
    const result =
      job.kind === "writer"
        ? await generateWriter(apiKey, job.input as WriterInput)
        : await generateRevise(apiKey, job.input as ReviseInput);

    console.log("[bg] Generation complete, writing result to Supabase");
    const { error: doneErr } = await supabase
      .from(JOBS_TABLE)
      .update({
        status: "done",
        output: result.data,
        meta: result.meta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    if (doneErr) {
      console.error("[bg] Failed to write done result:", doneErr.message, "code:", doneErr.code);
      // Try a simpler update without the large output to confirm DB connectivity
      await supabase
        .from(JOBS_TABLE)
        .update({ status: "error", error: `DB write failed: ${doneErr.message}`, updated_at: new Date().toISOString() })
        .eq("id", jobId);
      return new Response("db-error", { status: 200 });
    }

    console.log("[bg] Job", jobId, "completed successfully");
    return new Response("ok", { status: 200 });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Generation failed";
    console.error("[bg] Unhandled error for job", jobId, ":", errorMsg);
    const { error: errUpdateErr } = await supabase
      .from(JOBS_TABLE)
      .update({ status: "error", error: errorMsg, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (errUpdateErr) console.error("[bg] Also failed to write error status:", errUpdateErr.message);
    return new Response("error", { status: 200 });
  }
};
