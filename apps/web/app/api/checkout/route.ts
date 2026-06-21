import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const apiKey = process.env.COINBASE_COMMERCE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "COINBASE_COMMERCE_API_KEY not configured" }, { status: 500 });
  }

  const { projectName, documentType } = await req.json() as { projectName?: string; documentType?: string };

  const res = await fetch("https://api.commerce.coinbase.com/charges", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CC-Api-Key": apiKey,
      "X-CC-Version": "2018-03-22",
    },
    body: JSON.stringify({
      name: "Agent Studio Document",
      description: `${documentType ?? "Document"} — ${projectName ?? "Web3 Project"}`,
      pricing_type: "fixed_price",
      local_price: { amount: "1.00", currency: "USD" },
      metadata: { projectName, documentType },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Commerce API error: ${err.slice(0, 200)}` }, { status: 502 });
  }

  const { data } = await res.json() as { data: { id: string; hosted_url: string } };
  return NextResponse.json({ chargeId: data.id, hostedUrl: data.hosted_url });
}
