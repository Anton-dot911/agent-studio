import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const maxDuration = 60;

type DocBlock =
  | { type: "para"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "highlight"; label: string; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; text: string };

interface DocSection { label: string; blocks: DocBlock[] }
interface TechSpec { title: string; subtitle: string; sections: DocSection[] }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { techSpec, clientEmail, clientName, projectName } = body as {
      techSpec: TechSpec;
      clientEmail: string;
      clientName?: string;
      projectName: string;
    };

    if (!techSpec?.title || !clientEmail || !projectName) {
      return NextResponse.json({ error: "techSpec, clientEmail, and projectName are required" }, { status: 400 });
    }

    const startTime = Date.now();
    let pdfGenerated = false;
    let emailSent = false;
    let emailId: string | undefined;
    let pdfBuffer: ArrayBuffer | undefined;

    // Step 1: Generate PDF via PDFShift
    const pdfShiftKey = process.env.PDFSHIFT_API_KEY;
    if (pdfShiftKey) {
      try {
        const html = buildDocumentHtml(techSpec);
        const pdfRes = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`api:${pdfShiftKey}`).toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source: html,
            landscape: false,
            use_print_media: false,
            // Bottom margin prevents the final page's content from being clipped at
            // the page edge; top/sides stay 0 so the cover banner remains full-bleed.
            margin: { top: "0mm", right: "0mm", bottom: "12mm", left: "0mm" },
          }),
        });
        if (pdfRes.ok) {
          pdfBuffer = await pdfRes.arrayBuffer();
          pdfGenerated = true;
        }
      } catch (e) {
        console.error("[deliver] PDFShift error:", e);
      }
    }

    // Step 2: Send email via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        const from = process.env.RESEND_FROM_EMAIL || "Agent Studio <onboarding@resend.dev>";
        const name = clientName || "there";

        const attachments = pdfBuffer
          ? [{ filename: `${projectName.replace(/\s+/g, "-")}-tech-spec.pdf`, content: Buffer.from(pdfBuffer) }]
          : [];

        const { data, error } = await resend.emails.send({
          from,
          to: clientEmail,
          subject: `Your Tech Spec is Ready: ${projectName}`,
          html: buildEmailHtml(projectName, name),
          attachments,
        });

        if (!error && data?.id) {
          emailSent = true;
          emailId = data.id;
        } else if (error) {
          console.error("[deliver] Resend error:", error);
        }
      } catch (e) {
        console.error("[deliver] Email send error:", e);
      }
    }

    return NextResponse.json({
      success: true,
      data: { pdfGenerated, emailSent, emailId },
      meta: {
        agentName: "delivery",
        durationMs: Date.now() - startTime,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderBlock(b: DocBlock): string {
  if (b.type === "para") return `<p style="font-size:13.5px;line-height:1.7;color:#2a2a3a;margin-bottom:12px;">${esc(b.text)}</p>`;
  if (b.type === "bullets") {
    const items = b.items.map(it => `<li style="font-size:13.5px;line-height:1.7;color:#2a2a3a;margin-bottom:5px;">${esc(it)}</li>`).join("");
    return `<ul style="margin:0 0 12px 18px;">${items}</ul>`;
  }
  if (b.type === "highlight") return `<div style="background:#eef4fc;border-left:4px solid #0055b3;border-radius:4px;padding:14px 16px;margin-bottom:14px;"><div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#0055b3;font-weight:700;margin-bottom:6px;">${esc(b.label)}</div><div style="font-size:13.5px;line-height:1.6;color:#1a2a44;">${esc(b.text)}</div></div>`;
  if (b.type === "table") {
    const headers = b.headers.map(h => `<th style="background:#0055b3;color:#fff;text-align:left;padding:9px 12px;font-weight:600;word-break:break-word;overflow-wrap:anywhere;vertical-align:top;">${esc(h)}</th>`).join("");
    const rows = b.rows.map((r, ri) => `<tr style="page-break-inside:avoid;">${r.map(c => `<td style="padding:9px 12px;border-bottom:1px solid #e3e8f0;color:#2a2a3a;word-break:break-word;overflow-wrap:anywhere;white-space:normal;vertical-align:top;${ri % 2 === 1 ? "background:#f6f9fd;" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("");
    return `<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12.5px;table-layout:fixed;"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (b.type === "code") return `<pre style="background:#0d1530;color:#c8d4f0;padding:14px 16px;border-radius:6px;font-size:12px;line-height:1.6;margin-bottom:14px;font-family:monospace;white-space:pre-wrap;">${esc(b.text)}</pre>`;
  return "";
}

function buildDocumentHtml(spec: TechSpec): string {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const sections = spec.sections.map(sec => `
    <div style="margin-bottom:34px;page-break-inside:avoid;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <div style="width:4px;height:20px;background:#0055b3;border-radius:2px;flex-shrink:0;"></div>
        <h2 style="font-size:18px;font-weight:700;color:#0055b3;margin:0;">${esc(sec.label)}</h2>
      </div>
      ${sec.blocks.map(renderBlock).join("")}
    </div>`).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(spec.title)}</title>
  <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;color:#1a1a2e;}</style>
  </head><body>
  <div style="background:#0055b3;color:#fff;padding:56px 44px;">
    <div style="display:inline-block;font-size:11px;letter-spacing:2px;text-transform:uppercase;background:rgba(255,255,255,0.18);padding:6px 12px;border-radius:4px;margin-bottom:22px;">Agent Studio</div>
    <h1 style="font-size:30px;font-weight:800;line-height:1.2;margin-bottom:12px;">${esc(spec.title)}</h1>
    <p style="font-size:15px;opacity:0.92;line-height:1.5;">${esc(spec.subtitle)}</p>
  </div>
  <div style="padding:40px 44px;">${sections}</div>
  <div style="padding:20px 44px;border-top:1px solid #e3e8f0;font-size:11px;color:#8a93a8;">Generated by Agent Studio — ${esc(spec.title)} — Confidential — ${today}</div>
  </body></html>`;
}

function buildEmailHtml(projectName: string, name: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
    <div style="background:#0055b3;padding:32px 40px;border-radius:8px 8px 0 0;">
      <p style="color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Agent Studio</p>
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0;">Your document is ready</h1>
    </div>
    <div style="background:#f8f9fc;padding:32px 40px;border-radius:0 0 8px 8px;border:1px solid #e3e8f0;">
      <p style="font-size:15px;line-height:1.6;margin-bottom:16px;">Hi ${esc(name)},</p>
      <p style="font-size:15px;line-height:1.6;margin-bottom:16px;">Your <strong>${esc(projectName)}</strong> Technical Specification is attached as a PDF.</p>
      <p style="font-size:15px;line-height:1.6;margin-bottom:24px;">The document covers all 10 sections including architecture, smart contract design, security considerations, and cost estimation.</p>
      <p style="font-size:13px;color:#8a93a8;line-height:1.6;">Questions? Reply to this email or reach out on Upwork/Fiverr.</p>
    </div>
  </div>`;
}
