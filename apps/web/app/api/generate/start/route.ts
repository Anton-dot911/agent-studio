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
  const fnUrl = `${origin}/.netlify/functions/generate-background`;
  let triggerStatus = 0;
  try {
    const triggerRes = await fetch(fnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
    triggerStatus = triggerRes.status;
  } catch (e) {
    triggerStatus = 0;
  }

  // 202 = background function accepted. Anything else means the function isn't deployed
  // or is unreachable — fail fast so the client shows an error instead of waiting 13 min.
  if (triggerStatus !== 202) {
    await supabase
      .from(JOBS_TABLE)
      .update({ status: "error", error: `Background function unavailable (HTTP ${triggerStatus || "network error"}). Deploy may still be in progress — try again in ~1 minute.` })
      .eq("id", job.id);
    return NextResponse.json(
      { error: `Generation service unavailable (${triggerStatus || "network error"}). If Netlify just deployed, wait ~1 min and retry.` },
      { status: 503 },
    );
  }

  return NextResponse.json({ jobId: job.id });
}
