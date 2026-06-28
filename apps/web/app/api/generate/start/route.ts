import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, JOBS_TABLE, type JobKind } from "../../../../lib/jobs";
import { verifyUsdcPayment } from "../../../../lib/payment-verify";

const USED_PAYMENTS_TABLE = "as_used_payments";

// Creates a generation job and triggers the Netlify Background Function that runs it.
// Returns { jobId } immediately; the client polls /api/generate/status for the result.
//
// SECURITY: a "writer" job (the paid B2C entrypoint) requires a verified onchain
// USDC payment. The client must pass `paymentTxHash` from the confirmed sendCalls
// batch. The server verifies it onchain and records it so one payment unlocks
// exactly one generation. "revise" jobs are part of the same paid session and do
// not require a new payment.
export async function POST(req: NextRequest) {
  let body: { kind?: JobKind; input?: unknown; paymentTxHash?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { kind, input, paymentTxHash } = body;
  if (kind !== "writer" && kind !== "revise" && kind !== "critic" && kind !== "research" && kind !== "architect") {
    return NextResponse.json({ error: "kind must be 'writer', 'critic', 'revise', 'research', or 'architect'" }, { status: 400 });
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

  // -- Payment gate (writer only) ----------------------------------------------
  if (kind === "writer") {
    if (!paymentTxHash || typeof paymentTxHash !== "string") {
      return NextResponse.json({ error: "paymentTxHash is required for writer jobs" }, { status: 402 });
    }

    // 1. Verify the payment actually happened onchain.
    const result = await verifyUsdcPayment(paymentTxHash);
    if (!result.ok) {
      return NextResponse.json({ error: `Payment not verified: ${result.reason}` }, { status: 402 });
    }

    // 2. Anti-replay: claim the hash. UNIQUE PK makes a reused hash fail here.
    const { error: claimErr } = await supabase
      .from(USED_PAYMENTS_TABLE)
      .insert({
        tx_hash: paymentTxHash.toLowerCase(),
        payer: result.from ?? null,
        amount: result.amount?.toString() ?? null,
      });

    if (claimErr) {
      // 23505 = unique_violation -> this payment was already used.
      const alreadyUsed = (claimErr as { code?: string }).code === "23505";
      return NextResponse.json(
        { error: alreadyUsed ? "This payment was already used for a generation" : claimErr.message },
        { status: alreadyUsed ? 409 : 500 },
      );
    }
  }

  // -- Create the job ----------------------------------------------------------
  const { data: job, error } = await supabase
    .from(JOBS_TABLE)
    .insert({ kind, status: "pending", input })
    .select("id")
    .single();

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });
  }

  // Link the payment to the job for the audit trail (best-effort).
  if (kind === "writer" && paymentTxHash) {
    await supabase
      .from(USED_PAYMENTS_TABLE)
      .update({ job_id: job.id })
      .eq("tx_hash", paymentTxHash.toLowerCase());
  }

  // Fire the background function. Netlify returns 202 immediately for "-background"
  // functions, so this await resolves fast while the work continues asynchronously.
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
