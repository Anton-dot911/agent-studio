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

// When returnPdf is true, the route responds with the PDF bytes directly (for the
// in-app "Download PDF" button). Otherwise it emails the PDF (the Deliver flow).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { techSpec, clientEmail, clientName, projectName, returnPdf, pdfBase64 } = body as {
      techSpec: TechSpec;
      clientEmail?: string;
      clientName?: string;
      projectName: string;
      returnPdf?: boolean;
      // Browser-generated PDF (base64, no data: prefix). Used as the attachment when
      // the server-side PDFShift render is unavailable, so email always carries a PDF.
      pdfBase64?: string;
    };

    if (!techSpec?.title || !projectName) {
      return NextResponse.json({ error: "techSpec and projectName are required" }, { status: 400 });
    }
    if (!returnPdf && !clientEmail) {
      return NextResponse.json({ error: "clientEmail is required for delivery" }, { status: 400 });
    }

    const startTime = Date.now();
    let pdfGenerated = false;
    let emailSent = false;
    let emailId: string | undefined;
    let pdfBuffer: ArrayBuffer | undefined;
    let pdfError: string | null = null;

    // Step 1: Generate PDF via PDFShift (AntLab-branded HTML)
    const pdfShiftKey = process.env.PDFSHIFT_API_KEY;
    if (!pdfShiftKey) {
      pdfError = "PDFSHIFT_API_KEY is not set in this deploy context (add it in Netlify env with Deploy-preview + Production scope, then redeploy).";
    } else {
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
            margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
          }),
        });
        if (pdfRes.ok) {
          pdfBuffer = await pdfRes.arrayBuffer();
          pdfGenerated = true;
        } else {
          const errText = await pdfRes.text();
          pdfError = `PDFShift HTTP ${pdfRes.status}: ${errText.slice(0, 300)}`;
          console.error("[deliver]", pdfError);
        }
      } catch (e) {
        pdfError = `PDFShift request error: ${e instanceof Error ? e.message : String(e)}`;
        console.error("[deliver]", pdfError);
      }
    }

    // If the client just wants the PDF (Download button), return the bytes now.
    if (returnPdf) {
      if (!pdfBuffer) {
        return NextResponse.json(
          { error: `PDF generation failed. ${pdfError ?? "Unknown PDFShift error."}` },
          { status: 503 },
        );
      }
      const fileName = `${projectName.replace(/\s+/g, "-")}-AntLab-tech-spec.pdf`;
      return new NextResponse(Buffer.from(pdfBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    // Step 2: Send email via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey && clientEmail) {
      try {
        const resend = new Resend(resendKey);
        const from = process.env.RESEND_FROM_EMAIL || "AntLab <onboarding@resend.dev>";
        const name = clientName || "there";

        // Prefer the server PDFShift render; otherwise use the browser-generated PDF
        // the client sent. Either way the client gets a real PDF attachment.
        const attachmentBuffer = pdfBuffer
          ? Buffer.from(pdfBuffer)
          : pdfBase64
          ? Buffer.from(pdfBase64, "base64")
          : null;
        if (attachmentBuffer) pdfGenerated = true;
        const attachments = attachmentBuffer
          ? [{ filename: `${projectName.replace(/\s+/g, "-")}-tech-spec.pdf`, content: attachmentBuffer }]
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
      meta: { agentName: "delivery", durationMs: Date.now() - startTime, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// AntLab brand tokens
const BLUE = "#0055b3";
const BLUE_DARK = "#1a4a8a";
const INK = "#1a1a2e";
const BODY_INK = "#2a2a3a";
const CODE_BG = "#0d1530";
const CODE_FG = "#c8d4f0";
const WARN = "#c0392b";
const WARN_BG = "#fdf0ee";
const INFO_BG = "#eef4fc";

// Highlight blocks are coloured by intent. The document data has no severity field,
// so we infer it from the label keywords. Warning/critical labels render red; all
// others render blue (informational). This matches the AntLab sample hierarchy.
const WARN_WORDS = [
  "WARNING", "RISK", "CRITICAL", "LIABILITY", "BUDGET", "GATE", "CAUTION",
  "DANGER", "BLOCKER", "SCOPE CONTROL", "SCOPE DISCIPLINE", "DO NOT", "MUST NOT",
];
function isWarn(label: string): boolean {
  const up = label.toUpperCase();
  return WARN_WORDS.some((w) => up.includes(w));
}

// Space out a label like "BUDGET WARNING" -> "B U D G E T   W A R N I N G"
function spaced(label: string): string {
  return label.toUpperCase().split("").join("\u200a").replace(/ /g, "\u2003");
}

function renderBlock(b: DocBlock): string {
  if (b.type === "para")
    return `<p style="font-size:13px;line-height:1.7;color:${BODY_INK};margin:0 0 11px;">${esc(b.text)}</p>`;

  if (b.type === "bullets") {
    const items = b.items
      .map((it) => `<li style="font-size:13px;line-height:1.65;color:${BODY_INK};margin-bottom:6px;">${esc(it)}</li>`)
      .join("");
    return `<ul style="margin:0 0 12px 18px;padding:0;">${items}</ul>`;
  }

  if (b.type === "highlight") {
    const warn = isWarn(b.label);
    const accent = warn ? WARN : BLUE;
    const bg = warn ? WARN_BG : INFO_BG;
    return `<div style="background:${bg};border-left:4px solid ${accent};border-radius:4px;padding:13px 16px;margin:0 0 14px;page-break-inside:avoid;">
      <div style="font-size:9.5px;letter-spacing:2px;color:${accent};font-weight:700;margin-bottom:6px;">${esc(spaced(b.label))}</div>
      <div style="font-size:12.5px;line-height:1.6;color:#1a2a44;">${esc(b.text)}</div></div>`;
  }

  if (b.type === "table") {
    const colCount = b.headers.length || 1;
    const colWidth = (100 / colCount).toFixed(2);
    const cols = b.headers.map(() => `<col style="width:${colWidth}%;">`).join("");
    const headers = b.headers
      .map((h) => `<th style="background:${BLUE};color:#fff;text-align:left;padding:8px 10px;font-weight:600;vertical-align:top;word-wrap:break-word;overflow-wrap:break-word;">${esc(h)}</th>`)
      .join("");
    const rows = b.rows
      .map((r, ri) => `<tr>${r
        .map((c) => `<td style="padding:8px 10px;border-bottom:1px solid #e3e8f0;color:${BODY_INK};vertical-align:top;word-wrap:break-word;overflow-wrap:break-word;${ri % 2 === 1 ? `background:#f6f9fd;` : ""}">${esc(c)}</td>`)
        .join("")}</tr>`)
      .join("");
    // table-layout:fixed + colgroup forces column widths and kills "W ee ks" wrapping
    return `<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 14px;font-size:11.5px;page-break-inside:avoid;"><colgroup>${cols}</colgroup><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  if (b.type === "code")
    return `<pre style="background:${CODE_BG};color:${CODE_FG};padding:14px 16px;border-radius:6px;font-size:11px;line-height:1.55;margin:0 0 14px;font-family:'SF Mono',Menlo,Consolas,monospace;white-space:pre-wrap;word-wrap:break-word;page-break-inside:avoid;">${esc(b.text)}</pre>`;

  return "";
}

function buildDocumentHtml(spec: TechSpec): string {
  const sections = spec.sections
    .map((sec) => `
    <div style="margin-bottom:30px;page-break-inside:avoid;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:13px;">
        <div style="width:4px;height:19px;background:${BLUE};border-radius:2px;flex-shrink:0;"></div>
        <h2 style="font-size:17px;font-weight:700;color:${BLUE};margin:0;">${esc(sec.label)}</h2>
      </div>
      ${sec.blocks.map(renderBlock).join("")}
    </div>`)
    .join("");

  // Full blue cover page, then content. A4 page with a running AntLab footer.
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(spec.title)}</title>
  <style>
    @page { size: A4; margin: 0; }
    @page content { margin: 18mm 16mm 20mm 16mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #fff; color: ${INK}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .cover { background: ${BLUE}; color: #fff; height: 297mm; width: 100%; padding: 0 24mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
    .badge { display: inline-block; align-self: flex-start; font-size: 11px; letter-spacing: 4px; font-weight: 700; background: ${BLUE_DARK}; color: #fff; padding: 7px 12px; border-radius: 3px; margin-bottom: 26px; }
    .cover h1 { font-size: 34px; font-weight: 800; line-height: 1.18; margin-bottom: 14px; }
    .cover .sub { font-size: 14.5px; line-height: 1.55; color: rgba(255,255,255,0.9); max-width: 150mm; }
    .cover .meta { margin-top: 26px; font-size: 11px; letter-spacing: 1px; color: rgba(255,255,255,0.78); }
    .content { padding: 18mm 16mm 24mm 16mm; }
    .foot { margin-top: 8mm; padding-top: 6px; border-top: 1px solid #e3e8f0; font-size: 10px; color: #8a93a8; }
  </style></head><body>
  <div class="cover">
    <div class="badge">A N T L A B</div>
    <h1>${esc(spec.title)}</h1>
    <div class="sub">${esc(spec.subtitle)}</div>
    <div class="meta">Prepared by AntLab&nbsp;&nbsp;|&nbsp;&nbsp;Web3 Technical Documentation&nbsp;&nbsp;|&nbsp;&nbsp;Confidential</div>
  </div>
  <div class="content">
    ${sections}
    <div class="foot">Prepared by AntLab &mdash; ${esc(spec.title)} &mdash; Confidential</div>
  </div>
  </body></html>`;
}

function buildEmailHtml(projectName: string, name: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
    <div style="background:#0055b3;padding:32px 40px;border-radius:8px 8px 0 0;">
      <p style="color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">A N T L A B</p>
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0;">Your document is ready</h1>
    </div>
    <div style="background:#f8f9fc;padding:32px 40px;border-radius:0 0 8px 8px;border:1px solid #e3e8f0;">
      <p style="font-size:15px;line-height:1.6;margin-bottom:16px;">Hi ${esc(name)},</p>
      <p style="font-size:15px;line-height:1.6;margin-bottom:16px;">Your <strong>${esc(projectName)}</strong> Technical Specification is attached as a PDF.</p>
      <p style="font-size:15px;line-height:1.6;margin-bottom:24px;">The document covers all 10 sections including architecture, smart contract design, security considerations, and cost estimation.</p>
      <p style="font-size:13px;color:#8a93a8;line-height:1.6;">Prepared by AntLab. Questions? Just reply to this email.</p>
    </div>
  </div>`;
}
