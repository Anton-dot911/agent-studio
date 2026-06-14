// packages/agents/src/delivery-agent.ts

import {
  DeliveryAgentInput,
  DeliveryAgentOutput,
  TechSpec,
  DocBlock,
} from "./types";

export async function runDeliveryAgent(
  input: DeliveryAgentInput,
  config: {
    pdfShiftApiKey?: string;
    resendApiKey?: string;
    fromEmail?: string;
  }
): Promise<DeliveryAgentOutput> {
  const startTime = Date.now();
  const { techSpec, clientEmail, clientName, projectName } = input.data;

  let pdfGenerated = false;
  let emailSent = false;
  let emailId: string | undefined;
  let pdfBuffer: ArrayBuffer | undefined;

  try {
    // Step 1: Generate PDF via PDFShift (if API key available)
    if (config.pdfShiftApiKey) {
      const html = buildDocumentHtml(techSpec);
      const pdfRes = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${config.pdfShiftApiKey}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: html,
          landscape: false,
          use_print_media: false,
          margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
        }),
      });

      if (pdfRes.ok) {
        pdfBuffer = await pdfRes.arrayBuffer();
        pdfGenerated = true;
      }
    }

    // Step 2: Send email via Resend (if API key available)
    if (config.resendApiKey && clientEmail) {
      const { Resend } = await import("resend");
      const resend = new Resend(config.resendApiKey);

      const attachments = pdfBuffer
        ? [
            {
              filename: `${projectName.replace(/\s+/g, "-")}-tech-spec.pdf`,
              content: Buffer.from(pdfBuffer),
            },
          ]
        : [];

      const { data, error } = await resend.emails.send({
        from: config.fromEmail || "Agent Studio <onboarding@resend.dev>",
        to: clientEmail,
        subject: `Your Tech Spec is Ready: ${projectName}`,
        html: buildEmailHtml(projectName, clientName),
        attachments,
      });

      if (!error && data?.id) {
        emailSent = true;
        emailId = data.id;
      }
    }

    return {
      success: true,
      data: { pdfGenerated, emailSent, emailId },
      meta: {
        agentName: "delivery",
        durationMs: Date.now() - startTime,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        toolCallsCount: 0,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      meta: {
        agentName: "delivery",
        durationMs: Date.now() - startTime,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        toolCallsCount: 0,
      },
    };
  }
}

function renderBlock(b: DocBlock): string {
  if (b.type === "para") {
    return `<p style="font-size:13.5px;line-height:1.7;color:#2a2a3a;margin-bottom:12px;">${escHtml(b.text)}</p>`;
  }
  if (b.type === "bullets") {
    const items = b.items.map(it => `<li style="font-size:13.5px;line-height:1.7;color:#2a2a3a;margin-bottom:5px;">${escHtml(it)}</li>`).join("");
    return `<ul style="margin:0 0 12px 18px;">${items}</ul>`;
  }
  if (b.type === "highlight") {
    return `<div style="background:#eef4fc;border-left:4px solid #0055b3;border-radius:4px;padding:14px 16px;margin-bottom:14px;">
      <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#0055b3;font-weight:700;margin-bottom:6px;">${escHtml(b.label)}</div>
      <div style="font-size:13.5px;line-height:1.6;color:#1a2a44;">${escHtml(b.text)}</div>
    </div>`;
  }
  if (b.type === "table") {
    const headers = b.headers.map(h => `<th style="background:#0055b3;color:#fff;text-align:left;padding:9px 12px;font-weight:600;">${escHtml(h)}</th>`).join("");
    const rows = b.rows.map((r, ri) => {
      const bg = ri % 2 === 1 ? "background:#f6f9fd;" : "";
      const cells = r.map(c => `<td style="padding:9px 12px;border-bottom:1px solid #e3e8f0;color:#2a2a3a;${bg}">${escHtml(c)}</td>`).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    return `<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12.5px;"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (b.type === "code") {
    return `<pre style="background:#0d1530;color:#c8d4f0;padding:14px 16px;border-radius:6px;font-size:12px;line-height:1.6;overflow-x:auto;margin-bottom:14px;font-family:monospace;white-space:pre-wrap;">${escHtml(b.text)}</pre>`;
  }
  return "";
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildDocumentHtml(spec: TechSpec): string {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const sectionsHtml = spec.sections.map(sec => `
    <div style="margin-bottom:34px;page-break-inside:avoid;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <div style="width:4px;height:20px;background:#0055b3;border-radius:2px;flex-shrink:0;"></div>
        <h2 style="font-size:18px;font-weight:700;color:#0055b3;margin:0;">${escHtml(sec.label)}</h2>
      </div>
      ${sec.blocks.map(renderBlock).join("")}
    </div>
  `).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(spec.title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #1a1a2e; }
  </style>
</head>
<body>
  <div style="background:#0055b3;color:#fff;padding:56px 44px;">
    <div style="display:inline-block;font-size:11px;letter-spacing:2px;text-transform:uppercase;background:rgba(255,255,255,0.18);padding:6px 12px;border-radius:4px;margin-bottom:22px;">Agent Studio</div>
    <h1 style="font-size:30px;font-weight:800;line-height:1.2;margin-bottom:12px;">${escHtml(spec.title)}</h1>
    <p style="font-size:15px;opacity:0.92;line-height:1.5;">${escHtml(spec.subtitle)}</p>
  </div>
  <div style="padding:40px 44px;">
    ${sectionsHtml}
  </div>
  <div style="padding:20px 44px;border-top:1px solid #e3e8f0;font-size:11px;color:#8a93a8;">
    Generated by Agent Studio — ${escHtml(spec.title)} — Confidential — ${today}
  </div>
</body>
</html>`;
}

function buildEmailHtml(projectName: string, clientName?: string): string {
  const name = clientName || "there";
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
      <div style="background:#0055b3;padding:32px 40px;border-radius:8px 8px 0 0;">
        <p style="color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Agent Studio</p>
        <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0;">Your document is ready</h1>
      </div>
      <div style="background:#f8f9fc;padding:32px 40px;border-radius:0 0 8px 8px;border:1px solid #e3e8f0;">
        <p style="font-size:15px;line-height:1.6;margin-bottom:16px;">Hi ${escHtml(name)},</p>
        <p style="font-size:15px;line-height:1.6;margin-bottom:16px;">
          Your <strong>${escHtml(projectName)}</strong> Technical Specification has been generated and is attached to this email as a PDF.
        </p>
        <p style="font-size:15px;line-height:1.6;margin-bottom:24px;">
          The document covers all 10 sections including architecture, smart contract design, security considerations, and cost estimation.
        </p>
        <p style="font-size:13px;color:#8a93a8;line-height:1.6;">
          Questions? Reply to this email or reach out on Upwork/Fiverr.
        </p>
      </div>
    </div>
  `;
}
