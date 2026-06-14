// packages/agents/src/orchestrator.ts

import { runResearchAgent } from "./research-agent";
import { runWriterAgent } from "./writer-agent";
import { runQAAgent } from "./qa-agent";
import { runDeliveryAgent } from "./delivery-agent";
import {
  IntakeFormData,
  TechSpec,
  ResearchReport,
  QAReport,
  DeliveryResult,
  AgentOutput,
  calculateCostUsd,
} from "./types";

export interface OrchestratorConfig {
  apiKey: string;
  pdfShiftApiKey?: string;
  resendApiKey?: string;
  fromEmail?: string;
  webSearchResults?: string;
}

export interface PipelineResult {
  projectId: string;
  researchReport: ResearchReport;
  techSpec: TechSpec;
  qaReport: QAReport;
  delivery?: DeliveryResult;
  totalCostUsd: number;
  totalDurationMs: number;
  steps: Array<{ agent: string; durationMs: number; costUsd: number; success: boolean }>;
}

export async function runPipeline(
  projectId: string,
  intakeData: IntakeFormData,
  clientEmail: string | undefined,
  config: OrchestratorConfig,
  onStep?: (step: string) => void
): Promise<AgentOutput<PipelineResult>> {
  const pipelineStart = Date.now();
  const steps: PipelineResult["steps"] = [];

  // Step 1: Research
  onStep?.("research");
  const researchOut = await runResearchAgent(
    { projectId, data: intakeData },
    config.apiKey,
    config.webSearchResults
  );
  steps.push({
    agent: "research",
    durationMs: researchOut.meta.durationMs,
    costUsd: researchOut.meta.costUsd,
    success: researchOut.success,
  });
  if (!researchOut.success || !researchOut.data) {
    return { success: false, error: `Research failed: ${researchOut.error}`, meta: buildMeta(pipelineStart, steps) };
  }

  // Step 2: Writer
  onStep?.("writing");
  const writerOut = await runWriterAgent(
    { projectId, data: { researchReport: researchOut.data, documentType: "tech_spec" } },
    config.apiKey
  );
  steps.push({
    agent: "writer",
    durationMs: writerOut.meta.durationMs,
    costUsd: writerOut.meta.costUsd,
    success: writerOut.success,
  });
  if (!writerOut.success || !writerOut.data) {
    return { success: false, error: `Writer failed: ${writerOut.error}`, meta: buildMeta(pipelineStart, steps) };
  }

  // Step 3: QA
  onStep?.("qa");
  const qaOut = await runQAAgent(
    { projectId, data: { techSpec: writerOut.data, researchReport: researchOut.data } },
    config.apiKey
  );
  steps.push({
    agent: "qa",
    durationMs: qaOut.meta.durationMs,
    costUsd: qaOut.meta.costUsd,
    success: qaOut.success,
  });
  if (!qaOut.success || !qaOut.data) {
    return { success: false, error: `QA failed: ${qaOut.error}`, meta: buildMeta(pipelineStart, steps) };
  }

  // Step 4: Delivery (optional — only if clientEmail provided)
  let delivery: DeliveryResult | undefined;
  if (clientEmail) {
    onStep?.("delivery");
    const deliveryOut = await runDeliveryAgent(
      {
        projectId,
        data: {
          techSpec: writerOut.data,
          clientEmail,
          projectName: intakeData.projectName,
        },
      },
      {
        pdfShiftApiKey: config.pdfShiftApiKey,
        resendApiKey: config.resendApiKey,
        fromEmail: config.fromEmail,
      }
    );
    steps.push({
      agent: "delivery",
      durationMs: deliveryOut.meta.durationMs,
      costUsd: deliveryOut.meta.costUsd,
      success: deliveryOut.success,
    });
    delivery = deliveryOut.data;
  }

  const totalCostUsd = steps.reduce((sum, s) => sum + s.costUsd, 0);

  return {
    success: true,
    data: {
      projectId,
      researchReport: researchOut.data,
      techSpec: writerOut.data,
      qaReport: qaOut.data,
      delivery,
      totalCostUsd,
      totalDurationMs: Date.now() - pipelineStart,
      steps,
    },
    meta: buildMeta(pipelineStart, steps),
  };
}

function buildMeta(start: number, steps: PipelineResult["steps"]) {
  return {
    agentName: "orchestrator" as const,
    durationMs: Date.now() - start,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: steps.reduce((sum, s) => sum + s.costUsd, 0),
    toolCallsCount: steps.length,
  };
}
