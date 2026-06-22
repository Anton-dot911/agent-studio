// Netlify Background Function — runs up to 15 minutes (the "-background" suffix is
// what makes it asynchronous), so it can generate the full document with Sonnet 4.6
// without hitting the ~60s edge / 26s serverless limits that broke the old in-request
// streaming approach.
//
// Flow: the /api/generate/start route inserts a job row and fires this function with
// { jobId }. We load the job, run the Writer or Reviser, and write the result back to
// Supabase. The client polls /api/generate/status until status is "done" or "error".

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
    return new Response("Invalid body", { status: 400 });
  }
  if (!jobId) return new Response("jobId required", { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey || !apiKey) {
    return new Response("Server not configured", { status: 500 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Load the job
  const { data: job, error: loadErr } = await supabase
    .from(JOBS_TABLE)
    .select("id, kind, status, input")
    .eq("id", jobId)
    .single();

  if (loadErr || !job) {
    return new Response("Job not found", { status: 404 });
  }

  await supabase
    .from(JOBS_TABLE)
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    const result =
      job.kind === "writer"
        ? await generateWriter(apiKey, job.input as WriterInput)
        : await generateRevise(apiKey, job.input as ReviseInput);

    await supabase
      .from(JOBS_TABLE)
      .update({
        status: "done",
        output: result.data,
        meta: result.meta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return new Response("ok", { status: 200 });
  } catch (e) {
    await supabase
      .from(JOBS_TABLE)
      .update({
        status: "error",
        error: e instanceof Error ? e.message : "Generation failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return new Response("error", { status: 200 });
  }
};
