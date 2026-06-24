// Research is now delegated to the Netlify Background Function (same runtime as
// Writer/Reviser/Critic). This eliminates the edge-function timeout that caused
// "Stream ended without result" — web search + Sonnet 4.6 can take 60-120 s,
// which exceeds the ~30-40 s edge-function timeout.
//
// Flow: POST here → create job in Supabase → trigger background function → return { jobId }
// Frontend polls /api/generate/status?jobId=... until status "done" or "error".
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, JOBS_TABLE } from "../../../../lib/jobs";

export async function POST(req: NextRequest) {
  let body: { projectId?: string; intakeData?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { intakeData } = body;
  if (!intakeData?.projectName) {
    return NextResponse.json({ error: "intakeData.projectName is required" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Supabase not configured" }, { status: 500 });
  }

  const { data: job, error } = await supabase
    .from(JOBS_TABLE)
    .insert({ kind: "research", status: "pending", input: { intakeData } })
    .select("id")
    .single();

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  try {
    await fetch(`${origin}/.netlify/functions/generate-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
  } catch {
    // If the trigger fails the job stays "pending"; the client will surface a timeout.
  }

  return NextResponse.json({ jobId: job.id });
}
