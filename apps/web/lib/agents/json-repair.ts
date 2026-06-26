// Robust JSON extraction with truncation repair.
//
// Models occasionally get cut off by max_tokens mid-JSON. A naive
// `JSON.parse` (or a greedy `/\{[\s\S]*\}/` match) then throws a hard error and the
// whole agent run fails — losing an otherwise-good document. This recovers the
// largest valid object by walking the fragment and closing any brackets/braces the
// model left open, in the correct order (arrays close with `]`, objects with `}`),
// repairing an unterminated trailing string and a dangling comma along the way.
//
// Shared by Writer/Reviser (generate.ts), Critic, Architect, and QA so every
// document-shaped agent recovers from truncation identically.
export function parseJsonLoose(raw: string): unknown {
  const clean = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    if (start === -1) throw new Error("No JSON object found in model response");

    let fragment = clean.slice(start);
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    for (const c of fragment) {
      if (esc) { esc = false; continue; }
      if (c === "\\" && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (c === "{") stack.push("}");
        else if (c === "[") stack.push("]");
        else if (c === "}" || c === "]") stack.pop();
      }
    }
    // Close an unterminated string, then drop a dangling comma before appending the
    // remaining closers so we don't produce `{"a":"b",}`.
    if (inStr) fragment += '"';
    fragment = fragment.replace(/,\s*$/, "");
    fragment += stack.reverse().join("");
    return JSON.parse(fragment);
  }
}
