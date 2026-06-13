"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme");

    if (saved === "dark") {
      setDark(true);
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  const toggle = () => {
    const next = !dark;
    const theme = next ? "dark" : "light";

    setDark(next);
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  };

  return (
    <button
      aria-label="Toggle theme"
      onClick={toggle}
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 100,
        width: 40,
        height: 40,
        borderRadius: 20,
        background: "var(--card)",
        border: "1px solid var(--border2)",
        boxShadow: "0 2px 8px var(--shadow)",
        cursor: "pointer",
        fontSize: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.2s",
      }}
    >
      {dark ? "L" : "D"}
    </button>
  );
}
