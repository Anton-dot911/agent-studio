// apps/web/app/api/agents/research/route.ts
// Server-side only — API keys never reach the browser

import { NextRequest, NextResponse } from "next/server";
import { runResearchAgent } from "@agent-studio/agents";
import {
  webSearch,
  formatSearchResults,
  buildResearchQuery,
} from "@agent-studio/tools";
import type { IntakeFormData } from "@agent-studio/agents";

export const maxDuration = 120; // 2 хвилини для Netlify/Vercel

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, intakeData } = body as {
      projectId: string;
      intakeData: IntakeFormData;
    };

    // Валідація
    if (!projectId || !intakeData?.projectName) {
      return NextResponse.json(
        { error: "projectId and intakeData.projectName are required" },
        { status: 400 }
      );
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Опціональний веб-пошук (якщо є Tavily key)
    let webSearchResults: string | undefined;
    const tavilyKey = process.env.TAVILY_API_KEY;

    if (tavilyKey) {
      const query = buildResearchQuery(
        intakeData.projectName,
        intakeData.competitors,
        intakeData.blockchain
      );
      const results = await webSearch(query, tavilyKey, {
        maxResults: 5,
        searchDepth: "advanced",
      });
      if (results && results.length > 0) {
        webSearchResults = formatSearchResults(results);
      }
    }

    // Запускаємо Research Agent
    const output = await runResearchAgent(
      { projectId, data: intakeData },
      anthropicKey,
      webSearchResults
    );

    // Зберігаємо результат в Supabase (server-side)
    if (output.success && output.data) {
      await saveAgentRun(projectId, "research", intakeData, output);
    }

    return NextResponse.json(output);
  } catch (error) {
    console.error("[/api/agents/research]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── Supabase save ────────────────────────────────────────────────────────────

async function saveAgentRun(
  projectId: string,
  agentName: string,
  input: IntakeFormData,
  output: Awaited<ReturnType<typeof runResearchAgent>>
) {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabase.from("as_agent_runs").insert({
      project_id: projectId,
      agent_name: agentName,
      status: output.success ? "completed" : "failed",
      input_data: input,
      output_data: output.data ?? null,
      tokens_in: output.meta.inputTokens,
      tokens_out: output.meta.outputTokens,
      cost_usd: output.meta.costUsd,
      duration_ms: output.meta.durationMs,
      error: output.error ?? null,
    });
  } catch (err) {
    // Не фейлимо основний запит якщо DB запис не вдався
    console.error("[saveAgentRun] DB error:", err);
  }
}
