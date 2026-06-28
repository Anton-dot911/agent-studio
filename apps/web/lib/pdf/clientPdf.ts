// Browser-side AntLab-branded PDF generator (jsPDF).
//
// This is a dependency-free alternative to the server PDFShift render: it runs
// entirely in the browser, so Download and email-attachment work even when
// PDFShift is unavailable (no API key, out of credits, etc.). It mirrors the
// AntLab look: full blue cover page, blue section headers, blue/red highlight
// blocks, blue-header tables with wrapping, dark code blocks, AntLab footer.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type DocBlock =
  | { type: "para"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "highlight"; label: string; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; text: string };

export interface DocSection { label: string; blocks: DocBlock[] }
export interface TechSpec { title: string; subtitle: string; sections: DocSection[] }

type RGB = [number, number, number];
const BLUE: RGB = [0, 85, 179];
const BLUE_DARK: RGB = [26, 74, 138];
const BODY: RGB = [42, 42, 58];
const WARN: RGB = [192, 57, 43];
const WARN_BG: RGB = [253, 240, 238];
const INFO_BG: RGB = [238, 244, 252];
const HL_TEXT: RGB = [26, 42, 68];
const CODE_BG: RGB = [13, 21, 48];
const CODE_FG: RGB = [200, 212, 240];
const GRAY: RGB = [138, 147, 168];
const LINE: RGB = [227, 232, 240];
const STRIPE: RGB = [246, 249, 253];

// A4 portrait, millimetres.
const PW = 210, PH = 297, M = 16, TOP = 18, BOTTOM = 18;
const CW = PW - 2 * M;
const PAGE_BOTTOM = PH - BOTTOM;

const WARN_WORDS = [
  "WARNING", "RISK", "CRITICAL", "LIABILITY", "BUDGET", "GATE", "CAUTION",
  "DANGER", "BLOCKER", "SCOPE CONTROL", "SCOPE DISCIPLINE", "DO NOT", "MUST NOT",
];
const isWarn = (label: string) => {
  const up = (label || "").toUpperCase();
  return WARN_WORDS.some((w) => up.includes(w));
};
const spaced = (label: string) => (label || "").toUpperCase().split("").join(" ").replace(/ /g, " ");

export function buildAntLabPdf(spec: TechSpec): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const title = spec.title || "Technical Specification";

  // ── Cover page ──────────────────────────────────────────────────────────────
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, PW, PH, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(spaced("ANTLAB"), M, 120);
  doc.setFontSize(28);
  let cy = 140;
  for (const ln of doc.splitTextToSize(title, CW)) { doc.text(ln, M, cy); cy += 11; }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(235, 240, 250);
  cy += 3;
  for (const ln of doc.splitTextToSize(spec.subtitle || "", 150)) { doc.text(ln, M, cy); cy += 6.5; }
  doc.setFontSize(9);
  doc.setTextColor(210, 220, 238);
  doc.text("Prepared by AntLab    |    Web3 Technical Documentation    |    Confidential", M, cy + 10);

  // ── Content ─────────────────────────────────────────────────────────────────
  doc.addPage();
  let y = TOP;
  const ensure = (h: number) => { if (y + h > PAGE_BOTTOM) { doc.addPage(); y = TOP; } };

  for (const sec of spec.sections || []) {
    // Section header
    ensure(12);
    doc.setFillColor(...BLUE);
    doc.rect(M, y - 3.6, 1.6, 6, "F");
    doc.setTextColor(...BLUE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(sec.label || "", M + 4.5, y + 1.5);
    y += 9;
    doc.setFont("helvetica", "normal");

    for (const b of sec.blocks || []) {
      if (b.type === "para") {
        doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...BODY);
        for (const ln of doc.splitTextToSize(b.text || "", CW)) { ensure(5); doc.text(ln, M, y); y += 5; }
        y += 3;
      } else if (b.type === "bullets") {
        doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...BODY);
        for (const it of b.items || []) {
          const lines = doc.splitTextToSize(it || "", CW - 5);
          ensure(5); doc.text("•", M, y); doc.text(lines[0] ?? "", M + 5, y); y += 5;
          for (let i = 1; i < lines.length; i++) { ensure(5); doc.text(lines[i], M + 5, y); y += 5; }
          y += 1;
        }
        y += 2;
      } else if (b.type === "highlight") {
        const warn = isWarn(b.label);
        const accent = warn ? WARN : BLUE;
        const bg = warn ? WARN_BG : INFO_BG;
        doc.setFontSize(9.5);
        const textLines = doc.splitTextToSize(b.text || "", CW - 12);
        const boxH = 11 + textLines.length * 4.6 + 4;
        ensure(boxH);
        doc.setFillColor(...bg); doc.rect(M, y, CW, boxH, "F");
        doc.setFillColor(...accent); doc.rect(M, y, 1.6, boxH, "F");
        doc.setTextColor(...accent); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
        doc.text(spaced(b.label || ""), M + 5, y + 6);
        doc.setTextColor(...HL_TEXT); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
        let ty = y + 12;
        for (const ln of textLines) { doc.text(ln, M + 5, ty); ty += 4.6; }
        y += boxH + 4;
      } else if (b.type === "code") {
        doc.setFont("courier", "normal"); doc.setFontSize(9);
        const lines = doc.splitTextToSize(b.text || "", CW - 8);
        const boxH = lines.length * 4.2 + 8;
        ensure(boxH);
        doc.setFillColor(...CODE_BG); doc.rect(M, y, CW, boxH, "F");
        doc.setTextColor(...CODE_FG);
        let ty = y + 6;
        for (const ln of lines) { doc.text(ln, M + 4, ty); ty += 4.2; }
        y += boxH + 4;
        doc.setFont("helvetica", "normal");
      } else if (b.type === "table") {
        ensure(18);
        autoTable(doc, {
          head: [b.headers || []],
          body: (b.rows || []).map((r) => r.map((c) => c ?? "")),
          startY: y,
          margin: { left: M, right: M },
          tableWidth: CW,
          styles: { fontSize: 8.5, cellPadding: 2, overflow: "linebreak", valign: "top", textColor: BODY, lineColor: LINE, lineWidth: 0.1 },
          headStyles: { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: "bold" },
          alternateRowStyles: { fillColor: STRIPE },
          theme: "grid",
        });
        // @ts-expect-error lastAutoTable is attached by the plugin at runtime
        y = (doc.lastAutoTable?.finalY ?? y) + 5;
      }
    }
    y += 3;
  }

  // ── Footer on every content page (skip the cover, page 1) ────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 2; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
    doc.line(M, PH - 12, PW - M, PH - 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
    doc.text(`Prepared by AntLab — ${title} — Confidential`, M, PH - 8);
    doc.text(`${p - 1}`, PW - M, PH - 8, { align: "right" });
  }
  // Silence unused-color lint for BLUE_DARK if tree-shaken; it documents the palette.
  void BLUE_DARK;

  return doc;
}

export function pdfBlobFromSpec(spec: TechSpec): Blob {
  return buildAntLabPdf(spec).output("blob");
}

// Raw base64 (no data: prefix) for sending to the server as an email attachment.
export function pdfBase64FromSpec(spec: TechSpec): string {
  const uri = buildAntLabPdf(spec).output("datauristring");
  const comma = uri.indexOf(",");
  return comma >= 0 ? uri.slice(comma + 1) : uri;
}
