// Context Extractor endpoint (Dynamic Context Layer).
//
// Runs the Haiku-based Context Extractor inline and returns suggested context items
// as JSON. Extraction is fast (small Haiku call), so unlike the heavy generation
// agents it does not need the background-job + polling machinery — a direct edge
// call well within the timeout is simpler and lower-latency.
import { NextRequest, NextResponse } from "next/server";
import { generateExtractor, type ExtractorInput } from "../../../../lib/agents/extractor";

export const runtime = "edge";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: ExtractorInput;
  try {
    body = (await req.json()) as ExtractorInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || !body.agentRole) {
    return NextResponse.json({ error: "agentRole is required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  try {
    const result = await generateExtractor(apiKey, body);
    return NextResponse.json({ success: true, data: result.data, meta: result.meta });
  } catch (e) {
    // Extraction failure must never break the pipeline — return an empty set so the
    // client can continue without DCL items for this stage.
    console.error("[extract] error:", e);
    return NextResponse.json({
      success: false,
      data: { suggested_context_items: [] },
      error: e instanceof Error ? e.message : "Extraction failed",
    });
  }
}
