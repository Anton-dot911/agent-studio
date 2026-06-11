"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
export default function DashboardPage() {
const [dark, setDark] = useState(false);
useEffect(() => {
const saved = localStorage.getItem("theme");
if (saved === "dark") {
setDark(true);
document.documentElement.setAttribute("data-theme", "dark");
}
}, []);
const toggleTheme = () => {
const next = !dark;
setDark(next);
document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
localStorage.setItem("theme", next ? "dark" : "light");
};
return (
<main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>
<button onClick={toggleTheme} style={{
position: "fixed", top: 16, right: 16, zIndex: 100,
width: 40, height: 40, borderRadius: 20,
background: "var(--card)", border: "1px solid var(--border2)",
boxShadow: "0 2px 8px var(--shadow)",
cursor: "pointer", fontSize: 18,
display: "flex", alignItems: "center", justifyContent: "center",
}}>
{dark ? "sun" : "moon"}
</button>
<div style={{ marginBottom: 32 }}>
<p style={{ fontSize: 9, letterSpacing: "3px", textTransform: "uppercase", color: "va
AGENT STUDIO V0.1
</p>
<h1 style={{ fontFamily: "Arial, sans-serif", fontSize: 26, fontWeight: 800, color: "
Web3 Document Agent
</h1>
<p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7 }}>
AI-agents generate technical documents for Web3 projects. Tech Spec - Tokenomics -
</p>
</div>
<Link href="/run" style={{
display: "block", marginBottom: 28, padding: "20px",
borderRadius: 10, textDecoration: "none",
background: "var(--card)",
border: "1px solid var(--cyan)",
boxShadow: "0 2px 12px var(--shadow)",
}}>
<p style={{ fontSize: 9, letterSpacing: "2px", textTransform: "uppercase", color: "va
NEW PROJECT
</p>
<p style={{ fontSize: 16, fontWeight: 700, color: "var(--bright)", marginBottom: 4 }}
Run Research Agent
</p>
<p style={{ fontSize: 11, color: "var(--dim)" }}>
Fill intake form - Agent analyzes project - JSON report in ~45s
</p>
</Link>
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBotto
{[
{ label: "Projects", value: "0", color: "var(--cyan)" },
{ label: "Documents", value: "0", color: "var(--green)" },
{ label: "Spent", value: "$0.00", color: "var(--purple)" },
].map((s) => (
<div key={s.label} style={{
padding: "16px", borderRadius: 8,
background: "var(--card)", border: "1px solid var(--border)",
boxShadow: "0 1px 6px var(--shadow)",
}}>
<p style={{ fontSize: 9, letterSpacing: "2px", textTransform: "uppercase", {s.label}
color:
</p>
</div>
<p style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</p>
))}
</div>
<div style={{
padding: "20px", borderRadius: 10,
background: "var(--card)", border: "1px solid var(--border)",
boxShadow: "0 1px 6px var(--shadow)",
}}>
<p style={{ fontSize: 9, letterSpacing: "2px", textTransform: "uppercase", color: "va
PIPELINE (PHASE 1)
</p>
{[
{ n: "01", name: "Research Agent", active: true, time: "~45s", desc: "Analyzes proj
{ n: "02", name: "Writer Agent", active: false, time: "~60s", desc: "Generates full
{ n: "03", name: "QA Agent", active: false, time: "~30s", desc: "Checks quality, fi
{ n: "04", name: "Delivery Agent", active: false, time: "~10s", desc: "PDF + email
].map((step) => (
<div key={step.n} style={{ display: "flex", alignItems: "flex-start", gap: 14, marg
<div style={{
width: 30, height: 30, borderRadius: 6, flexShrink: 0,
display: "flex", alignItems: "center", justifyContent: "center",
fontSize: 10, fontWeight: 700,
background: step.active ? "rgba(0,102,204,0.12)" : "var(--card2)",
border: step.active ? "1px solid rgba(0,102,204,0.4)" : "1px solid var(--border
color: step.active ? "var(--cyan)" : "var(--dim)",
}}>
{step.n}
</div>
<div style={{ flex: 1 }}>
<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}
<span style={{ fontSize: 13, fontWeight: 600, color: step.active ? "var(--bri
{step.name}
</span>
{step.active ? (
<span style={{
fontSize: 9, padding: "2px 7px", borderRadius: 3,
background: "rgba(10,122,80,0.12)", border: "1px solid rgba(10,122,80,0.3
color: "var(--green)", fontWeight: 700, letterSpacing: "1px",
}}>ACTIVE</span>
) : (
<span style={{ fontSize: 9, color: "var(--dim)", letterSpacing: "1px" }}>PH
)}
</div>
</div>
</div>
<span style={{ fontSize: 9, color: "var(--dim)" }}>{step.time}</span>
<p style={{ fontSize: 11, color: "var(--dim)" }}>{step.desc}</p>
))}
</div>
</main>
);
}
