import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const maxDuration = 300;

// Consume SSE stream from internal agents and return final data
async function consumeSSE(res: Response): Promise<Record<string, unknown>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (!json || json === "[DONE]") continue;
        const event = JSON.parse(json) as { type: string; success?: boolean; data?: Record<string, unknown>; error?: string };
        if (event.type === "done") {
          if (!event.success) throw new Error(event.error ?? "Agent failed");
          return event.data ?? {};
        }
        if (event.type === "error") throw new Error(event.error ?? "Agent error");
      }
    }
  }
  throw new Error("Stream ended without result");
}

async function callAgent(baseUrl: string, path: string, body: object): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`${path} returned ${res.status}`);
  return consumeSSE(res);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { intakeData: Record<string, string> };
    const { intakeData } = body;

    if (!intakeData?.projectName) {
      return NextResponse.json({ error: "intakeData.projectName is required" }, { status: 400 });
    }

    const baseUrl = `${req.nextUrl.protocol}//${req.headers.get("host")}`;

    // Step 1: Research
    const researchData = await callAgent(baseUrl, "/api/agents/research", {
      projectId: `p_${Date.now()}`,
      intakeData,
    });

    // Step 2: Writer
    const writerData = await callAgent(baseUrl, "/api/agents/writer", {
      intakeData,
      researchReport: researchData,
    });

    // Step 3: QA
    const qaData = await callAgent(baseUrl, "/api/agents/qa", {
      techSpec: writerData,
      researchReport: researchData,
      documentType: intakeData.documentNeeds,
    }) as { score: number; humanChecklist: string[]; criticalIssues: string[]; majorIssues: string[]; minorIssues: string[]; summary: string };

    // Step 4: Revise if score < 9
    let finalDoc = writerData;
    if ((qaData.score ?? 0) < 9) {
      finalDoc = await callAgent(baseUrl, "/api/agents/revise", {
        techSpec: writerData,
        qaReport: qaData,
        intakeData,
        documentType: intakeData.documentNeeds,
      });
    }

    return NextResponse.json({
      success: true,
      document: finalDoc,
      qa: { score: qaData.score, status: (qaData as { status?: string }).status },
      revised: (qaData.score ?? 0) < 9,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
