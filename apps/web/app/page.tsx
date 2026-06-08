// apps/web/app/page.tsx
import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="max-w-3xl mx-auto px-5 py-10">
      {/* Header */}
      <div className="mb-10">
        <p className="text-[10px] tracking-[3px] uppercase text-[var(--dim)] mb-2">
          Agent Studio · v0.1
        </p>
        <h1 className="text-2xl font-bold text-[var(--bright)] mb-2"
            style={{ fontFamily: "Syne, sans-serif" }}>
          Web3 Document Agent
        </h1>
        <p className="text-sm text-[var(--text)] leading-relaxed">
          AI-агенти генерують технічні документи для Web3 проєктів.
          Tech Spec · Tokenomics · DeFi Audit
        </p>
      </div>

      {/* Quick action */}
      <Link href="/run" className="block mb-8 p-5 rounded-lg border
        border-[var(--cyan)] border-opacity-30
        bg-[var(--card)]
        hover:border-opacity-60 transition-all group">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-[2px] uppercase text-[var(--cyan)] mb-1">
              Новий проєкт
            </p>
            <p className="text-[var(--bright)] font-medium">
              Запустити Research Agent →
            </p>
            <p className="text-xs text-[var(--dim)] mt-1">
              Заповни intake форму · Агент аналізує проєкт · JSON звіт за ~45с
            </p>
          </div>
          <div className="text-2xl text-[var(--cyan)] opacity-40 group-hover:opacity-100 transition-opacity">
            ⬡
          </div>
        </div>
      </Link>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: "Проєктів", value: "0", accent: "var(--cyan)" },
          { label: "Документів", value: "0", accent: "var(--green)" },
          { label: "Витрачено", value: "$0.00", accent: "var(--purple)" },
        ].map((s) => (
          <div key={s.label} className="p-4 rounded-lg bg-[var(--card)]
            border border-[var(--border)]">
            <p className="text-[9px] tracking-[2px] uppercase text-[var(--dim)] mb-2">
              {s.label}
            </p>
            <p className="text-xl font-semibold" style={{ color: s.accent }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Pipeline info */}
      <div className="p-5 rounded-lg bg-[var(--card)] border border-[var(--border)]">
        <p className="text-[9px] tracking-[2px] uppercase text-[var(--dim)] mb-4">
          Pipeline (Phase 1)
        </p>
        <div className="flex flex-col gap-3">
          {[
            { n: "01", name: "Research Agent", status: "active", time: "~45s", desc: "Аналізує проєкт, конкурентів, ринок" },
            { n: "02", name: "Writer Agent", status: "coming", time: "~60s", desc: "Генерує повний технічний документ" },
            { n: "03", name: "QA Agent", status: "coming", time: "~30s", desc: "Перевіряє якість і виправляє слабкі секції" },
            { n: "04", name: "Delivery Agent", status: "coming", time: "~10s", desc: "PDF + email клієнту" },
          ].map((step) => (
            <div key={step.n} className="flex items-start gap-4">
              <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{
                  background: step.status === "active" ? "rgba(0,212,255,0.1)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${step.status === "active" ? "rgba(0,212,255,0.3)" : "rgba(255,255,255,0.06)"}`,
                  color: step.status === "active" ? "var(--cyan)" : "var(--dim)",
                  fontSize: 10, fontWeight: 700,
                }}>
                {step.n}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium"
                    style={{ color: step.status === "active" ? "var(--bright)" : "var(--dim)" }}>
                    {step.name}
                  </span>
                  <span className="text-[9px] tracking-[1px] px-1.5 py-0.5 rounded"
                    style={{
                      background: step.status === "active" ? "rgba(46,204,143,0.1)" : "transparent",
                      color: step.status === "active" ? "var(--green)" : "var(--dim)",
                      border: `1px solid ${step.status === "active" ? "rgba(46,204,143,0.3)" : "transparent"}`,
                    }}>
                    {step.status === "active" ? "ACTIVE" : "PHASE 2"}
                  </span>
                  <span className="text-[9px] text-[var(--dim)]">{step.time}</span>
                </div>
                <p className="text-xs text-[var(--dim)]">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
