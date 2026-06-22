import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, JOBS_TABLE } from "../../../../lib/jobs";

// Returns the current state of a generation job for client polling.
export async function GET(req: NextRequest) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Supabase not configured" }, { status: 500 });
  }

  const { data: job, error } = await supabase
    .from(JOBS_TABLE)
    .select("status, output, meta, error")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    output: job.output,
    meta: job.meta,
    error: job.error,
  });
}
