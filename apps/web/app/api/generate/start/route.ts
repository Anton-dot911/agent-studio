import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, JOBS_TABLE, type JobKind } from "../../../../lib/jobs";

// Creates a generation job and triggers the Netlify Background Function that runs it.
// Returns { jobId } immediately; the client polls /api/generate/status for the result.
export async function POST(req: NextRequest) {
  let body: { kind?: JobKind; input?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { kind, input } = body;
  if (kind !== "writer" && kind !== "revise") {
    return NextResponse.json({ error: "kind must be 'writer' or 'revise'" }, { status: 400 });
  }
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Supabase not configured" }, { status: 500 });
  }

  const { data: job, error } = await supabase
    .from(JOBS_TABLE)
    .insert({ kind, status: "pending", input })
    .select("id")
    .single();

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });
  }

  // Fire the background function. Netlify returns 202 immediately for "-background"
  // functions, so this await resolves fast while the work continues asynchronously.
  // Use the request origin so deploy previews hit their own background function.
  const origin = new URL(req.url).origin;
  try {
    await fetch(`${origin}/.netlify/functions/generate-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
  } catch {
    // If the trigger fails the job stays "pending"; the client will surface a timeout.
    // Don't fail the request — the job row exists and can be retried.
  }

  return NextResponse.json({ jobId: job.id });
}
