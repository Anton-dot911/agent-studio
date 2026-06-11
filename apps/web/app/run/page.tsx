"use client";
// apps/web/app/run/page.tsx

import { useState } from "react";
import Link from "next/link";
import type { IntakeFormData, ResearchReport } from "@agent-studio/agents";

type RunStatus = "idle" | "running" | "done" | "error";

const INITIAL_FORM: IntakeFormData = {
  projectName: "",
  concept: "",
  problem: "",
  targetAudience: "",
  blockchain: "",
  existingCode: "",
  competitors: "",
  teamInfo: "",
  timeline: "",
  budget: "",
  documentNeeds: "",
};

const FIELDS: { key: keyof IntakeFormData; label: string; hint: string; rows?: number }[] = [
  { key: "projectName", label: "01 · Назва проєкту", hint: "Коротка назва" },
  { key: "concept", label: "02 · Концепція", hint: "3–5 речень що будуєте", rows: 3 },
  { key: "problem", label: "03 · Проблема", hint: "Яку проблему вирішує?", rows: 2 },
  { key: "targetAudience", label: "04 · Аудиторія", hint: "Хто користувач?" },
  { key: "blockchain", label: "05 · Блокчейн", hint: "Base, Ethereum, Solana, або N/A" },
  { key: "existingCode", label: "06 · Існуючий код", hint: "Посилання або 'немає'" },
  { key: "competitors", label: "07 · Конкуренти", hint: "Через кому: Uniswap, Aave..." },
  { key: "teamInfo", label: "08 · Команда", hint: "Розмір і досвід" },
  { key: "timeline", label: "09 · Таймлайн", hint: "MVP за скільки?" },
  { key: "budget", label: "10 · Бюджет", hint: "<$10k / $10-50k / $50k+" },
  { key: "documentNeeds", label: "11 · Що потрібно", hint: "Tech Spec / Tokenomics / DeFi Audit", rows: 2 },
];

export default function RunPage() {
  const [form, setForm] = useState<IntakeFormData>(INITIAL_FORM);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [result, setResult] = useState<ResearchReport | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [meta, setMeta] = useState<{ costUsd: number; tokens: number } | null>(null);

  const handleChange = (key: keyof IntakeFormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleRun = async () => {
    if (!form.projectName || !form.concept) {
      setError("Заповніть хоча б назву і концепцію");
      return;
    }

    setStatus("running");
    setResult(null);
    setError("");
    setMeta(null);

    const start = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      300
    );

    try {
      const res = await fetch("/api/agents/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: `project_${Date.now()}`,
          intakeData: form,
        }),
      });

      clearInterval(timer);
      setElapsed(Math.floor((Date.now() - start) / 1000));

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Agent failed");
      }

      setResult(data.data as ResearchReport);
      setMeta({
        costUsd: data.meta?.costUsd ?? 0,
        tokens: (data.meta?.inputTokens ?? 0) + (data.meta?.outputTokens ?? 0),
      });
      setStatus("done");
    } catch (e) {
      clearInterval(timer);
      setError(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    }
  };

  return (
    <main className="max-w-3xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link href="/" className="text-[var(--dim)] hover:text-[var(--text)] text-sm transition-colors">
          ← Dashboard
        </Link>
        <span className="text-[var(--border2)]">/</span>
        <span className="text-[10px] tracking-[2px] uppercase text-[var(--cyan)]">
          Research Agent
        </span>
      </div>

      {/* Form */}
      {status === "idle" || status === "error" ? (
        <div>
          <h2 className="text-lg font-bold text-[var(--bright)] mb-1"
              style={{ fontFamily: "Syne, sans-serif" }}>
            Intake форма
          </h2>
          <p className="text-xs text-[var(--dim)] mb-6">
            Заповни → Research Agent проаналізує проєкт за ~45 секунд
          </p>

          <div className="flex flex-col gap-4 mb-6">
            {FIELDS.map(({ key, label, hint, rows }) => (
              <div key={key}>
                <label className="block text-[9px] tracking-[2px] uppercase text-[var(--dim)] mb-1.5">
                  {label}
                </label>
                {rows ? (
                  <textarea
                    rows={rows}
                    placeholder={hint}
                    value={form[key]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className="w-full bg-[var(--card)] border border-[var(--border)]
                      rounded-md px-3 py-2 text-sm text-[var(--text)]
                      placeholder:text-[var(--dim)] focus:outline-none
                      focus:border-[var(--cyan)] focus:border-opacity-50
                      resize-none transition-colors"
                    style={{ fontFamily: "inherit" }}
                  />
                ) : (
                  <input
                    type="text"
                    placeholder={hint}
                    value={form[key]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className="w-full bg-[var(--card)] border border-[var(--border)]
                      rounded-md px-3 py-2 text-sm text-[var(--text)]
                      placeholder:text-[var(--dim)] focus:outline-none
                      focus:border-[var(--cyan)] focus:border-opacity-50
                      transition-colors"
                    style={{ fontFamily: "inherit" }}
                  />
                )}
              </div>
            ))}
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-md bg-red-900/20 border border-red-800/30 text-red-400 text-xs">
              ⚠ {error}
            </div>
          )}

          <button onClick={handleRun} className="w-full py-3 rounded-md text-[10px]
            tracking-[2px] uppercase font-semibold transition-all
            bg-[var(--cyan)] bg-opacity-10 border border-[var(--cyan)]
            border-opacity-30 text-[var(--cyan)]
            hover:bg-opacity-20 hover:border-opacity-60">
            ⬡ Запустити Research Agent
          </button>
        </div>
      ) : null}

      {/* Running */}
      {status === "running" && (
        <div className="text-center py-20">
          <div className="inline-flex items-center gap-3 text-[var(--cyan)]">
            <div className="w-5 h-5 rounded-full border-2 border-[var(--cyan)]
              border-t-transparent animate-spin" />
            <span className="text-sm tracking-widest uppercase">
              Research Agent · {elapsed}s
            </span>
          </div>
          <p className="text-xs text-[var(--dim)] mt-4">
            Аналізую проєкт, ринок і конкурентів...
          </p>
        </div>
      )}

      {/* Result */}
      {status === "done" && result && (
        <div>
          {/* Meta bar */}
          <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[var(--green)]" />
              <span className="text-xs text-[var(--green)]">Готово за {elapsed}s</span>
            </div>
            <div className="flex gap-3">
              {meta && (
                <>
                  <span className="text-[9px] px-2 py-1 rounded bg-[var(--card)]
                    border border-[var(--border)] text-[var(--dim)]">
                    {meta.tokens.toLocaleString()} токенів
                  </span>
                  <span className="text-[9px] px-2 py-1 rounded bg-[var(--card)]
                    border border-[var(--border)] text-[var(--dim)]">
                    ${meta.costUsd.toFixed(4)}
                  </span>
                </>
              )}
              <button onClick={() => { setStatus("idle"); setResult(null); }}
                className="text-[9px] px-2 py-1 rounded bg-[var(--card)]
                  border border-[var(--border)] text-[var(--dim)]
                  hover:text-[var(--text)] transition-colors cursor-pointer">
                ↺ Новий
              </button>
            </div>
          </div>

          {/* Report sections */}
          <ReportView report={result} />
        </div>
      )}
    </main>
  );
}

// ─── Report rendering ─────────────────────────────────────────────────────────

function ReportView({ report }: { report: ResearchReport }) {
  const sections = [
    { key: "projectSummary", label: "Project Summary", accent: "#00d4ff", content: report.projectSummary },
    { key: "problemAnalysis", label: "Problem Analysis", accent: "#f472b6", content: report.problemAnalysis },
    { key: "marketContext", label: "Market Context", accent: "#2ecc8f", content: report.marketContext },
    { key: "competitiveAnalysis", label: "Competitive Analysis", accent: "#8b7ff0", content: report.competitiveAnalysis },
    { key: "technicalLandscape", label: "Technical Landscape", accent: "#f0843a", content: report.technicalLandscape },
    { key: "teamAssessment", label: "Team Assessment", accent: "#e0b84a", content: report.teamAssessment },
    { key: "redFlags", label: "⚠ Red Flags", accent: "#e05555", content: report.redFlags },
    { key: "opportunities", label: "Opportunities", accent: "#2ecc8f", content: report.opportunities },
    { key: "notesForWriter", label: "Notes for Writer Agent", accent: "#3a4560", content: report.notesForWriter },
  ];

  return (
    <div className="flex flex-col gap-3">
      {sections.map(({ key, label, accent, content }) => (
        <div key={key} className="rounded-lg bg-[var(--card)] border border-[var(--border)] overflow-hidden">
          <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: accent, boxShadow: `0 0 4px ${accent}` }} />
            <span className="text-[9px] tracking-[1.5px] uppercase font-semibold" style={{ color: accent }}>
              {label}
            </span>
          </div>
          <div className="px-4 py-3">
            <ContentRenderer content={content} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ContentRenderer({ content }: { content: unknown }) {
  if (typeof content === "string") {
    return <p className="text-sm text-[var(--text)] leading-relaxed">{content}</p>;
  }
  if (Array.isArray(content)) {
    return (
      <ul className="space-y-1.5">
        {content.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-[var(--text)] leading-relaxed">
            <span className="text-[var(--dim)] flex-shrink-0 mt-0.5">▸</span>
            <ContentRenderer content={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (content && typeof content === "object") {
    return (
      <div className="space-y-2">
        {Object.entries(content as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="flex gap-3 text-sm">
            <span className="text-[9px] uppercase tracking-wider text-[var(--dim)] flex-shrink-0 min-w-[120px] pt-0.5">
              {k}
            </span>
            <span className="text-[var(--text)] leading-relaxed">
              <ContentRenderer content={v} />
            </span>
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-sm text-[var(--text)]">{String(content)}</span>;
}
