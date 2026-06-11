import Link from “next/link”;
import ThemeToggle from “
./components/ThemeToggle”;
export default function DashboardPage() {
return (
<main style={{ maxWidth: 720, margin: “0 auto”
, padding: “32px 20px” }}>
<ThemeToggle />
```
<div style={{ marginBottom: 32 }}>
<p style={{ fontSize: 9, letterSpacing: "3px"
, textTransform: "uppercase"
, color: "var(--dim)"
,
marginBottom: 8 }}>
AGENT STUDIO V0.1
</p>
<h1 style={{ fontFamily: "Arial, sans-serif"
, fontSize: 26, fontWeight: 800, color: "var(--bright)"
,
marginBottom: 8 }}>
Web3 Document Agent
</h1>
<p style={{ fontSize: 13, color: "var(--text)"
, lineHeight: 1.7 }}>
AI-agents generate technical documents for Web3 projects. Tech Spec Tokenomics DeFi
Audit
</p>
</div>
<Link href="/run" style={{
display: "block"
, marginBottom: 28, padding: "20px"
,
borderRadius: 10, textDecoration: "none"
,
background: "var(--card)"
,
border: "1px solid var(--cyan)"
,
boxShadow: "0 2px 12px var(--shadow)"
,
}}>
<p style={{ fontSize: 9, letterSpacing: "2px"
, textTransform: "uppercase"
, color: "var(--cyan)"
,
marginBottom: 6 }}>
NEW PROJECT
</p>
<p style={{ fontSize: 16, fontWeight: 700, color: "var(--bright)"
, marginBottom: 4 }}>
Run Research Agent
</p>
<p style={{ fontSize: 11, color: "var(--dim)" }}>
Fill intake form Agent analyzes project JSON report in ~45s
</p>
</Link>
<div style={{ display: "grid"
, gridTemplateColumns: "1fr 1fr 1fr"
, gap: 12, marginBottom: 28 }}>
{[
{ label: "Projects"
, value: "0"
, color: "var(--cyan)" },
{ label: "Documents"
, value: "0"
, color: "var(--green)" },
{ label: "Spent"
, value: "$0.00"
, color: "var(--purple)" },
].map((s) => (
<div key={s.label} style={{
padding: "16px"
, borderRadius: 8,
background: "var(--card)"
, border: "1px solid var(--border)"
,
boxShadow: "0 1px 6px var(--shadow)"
,
}}>
<p style={{ fontSize: 9, letterSpacing: "2px"
, textTransform: "uppercase"
, color: "var(--dim)"
,
marginBottom: 8 }}>
{s.label}
</p>
<p style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</p>
</div>
))}
</div>
<div style={{
padding: "20px"
, borderRadius: 10,
background: "var(--card)"
, border: "1px solid var(--border)"
,
boxShadow: "0 1px 6px var(--shadow)"
,
}}>
<p style={{ fontSize: 9, letterSpacing: "2px"
, textTransform: "uppercase"
, color: "var(--dim)"
,
marginBottom: 16 }}>
PIPELINE (PHASE 1)
</p>
{[
{ n: "01"
, name: "Research Agent"
, status: "active"
, time: "
~45s"
, desc: "Analyzes project,
competitors, market" },
{ n: "02"
, name: "Writer Agent"
, status: "soon"
, time: "
~60s"
, desc: "Generates full technical
document" },
{ n: "03"
, name: "QA Agent"
, status: "soon"
, time: "
~30s"
, desc: "Checks quality, fixes weak
sections" },
{ n: "04"
, name: "Delivery Agent"
, status: "soon"
, time: "
~10s"
, desc: "PDF + email to client"
},
].map((step) => (
<div key={step.n} style={{ display: "flex"
, alignItems: "flex-start"
, gap: 14, marginBottom: 14
}}>
<div style={{
width: 30, height: 30, borderRadius: 6, flexShrink: 0,
display: "flex"
, alignItems: "center"
, justifyContent: "center"
,
fontSize: 10, fontWeight: 700,
background: step.status === "active" ? "rgba(0,102,204,0.12)" : "var(--card2)"
,
border: step.status === "active" ? "1px solid rgba(0,102,204,0.4)" : "1px solid
var(--border)"
,
color: step.status === "active" ? "var(--cyan)" : "var(--dim)"
,
}}>
{step.n}
</div>
<div style={{ flex: 1 }}>
<div style={{ display: "flex"
, alignItems: "center"
, gap: 8, marginBottom: 3 }}>
<span style={{ fontSize: 13, fontWeight: 600, color: step.status === "active" ?
"var(--bright)" : "var(--dim)" }}>
{step.name}
</span>
{step.status === "active" && (
<span style={{
fontSize: 9, letterSpacing: "1px"
, padding: "2px 7px"
, borderRadius: 3,
background: "rgba(10,122,80,0.12)"
, border: "1px solid rgba(10,122,80,0.35)"
,
color: "var(--green)"
, fontWeight: 700,
}}>ACTIVE</span>
)}
{step.status === "soon" && (
<span style={{ fontSize: 9, color: "var(--dim)"
, letterSpacing: "1px" }}>PHASE 2</span>
)}
</div>
</div>
</div>
<span style={{ fontSize: 9, color: "var(--dim)" }}>{step.time}</span>
<p style={{ fontSize: 11, color: "var(--dim)" }}>{step.desc}</p>
))}
</div>
</main>
```
);
}
