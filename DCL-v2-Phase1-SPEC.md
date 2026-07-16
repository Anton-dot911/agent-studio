# DCL v2 -- Phase 1 SPEC (Technical Task for Claude Code)

Status: ready for implementation
Author role: architecture / spec (this chat). Implementation: Claude Code.
Target repo: agent-studio, post boundary-refactor (branch with lib/dcl/ + lib/dcl-adapter.ts).
Format: this is a specification, NOT a code patch. Build directly in the repo, run tests, commit.

--------------------------------------------------------------------------------

## 0. Context and confirmed assumptions

This spec is grounded in the ACTUAL post-refactor codebase, not pre-refactor guesses.
Verified current state:

- Generic DCL core exists and is domain-agnostic:
  - lib/dcl/types.ts        -- ContextStatus, RiskLevel, RecommendedStatus, SuggestedContextItem,
                               ContextItem, AgentOutput, AgentRun, Artifact, ContextSnapshot,
                               ENABLE_DCL, DCL_MAX_CONTEXT_ITEMS_PER_PACKAGE
  - lib/dcl/classify.ts     -- ClassificationPolicy, classifyStatus, materialize, seedContextItems, __resetSeq
  - lib/dcl/package.ts      -- buildContextPackage, renderContextPackage, buildAndRender, PackageConfig, etc.
- Single domain binding point: lib/dcl-adapter.ts
  - AgentRole already includes "final_qa"
  - REVIEW_ROLES already includes "final_qa"
  - TASK_BY_ROLE already has a final_qa task line
  - HIGH_IMPACT_TYPES, SECTION_TYPES, POLICY, PACKAGE_CONFIG, baseContextFromIntake, seedBaseContextItems
- Pipeline:
  - Browser orchestrator: apps/web/app/run/page.tsx
    research -> writer -> [qa || critic || architect] -> revise -> document (download)
    DCL extraction and packaging run in the browser; context items live in React state (contextItems).
  - Background worker: apps/web/netlify/functions/generate-background.ts
    dispatches on job.kind in {writer, critic, research, architect, revise} and returns { data, meta }.
  - Job plumbing: /api/generate/start (creates row in as_generation_jobs, triggers bg fn), /api/generate/status (poll).
  - Agents: lib/agents/{generate,critic,research,architect,extractor,json-repair}.ts
  - Deliver: app/api/agents/deliver/route.ts (PDFShift render).
  - Migrations present: 001_agent_studio, 002_generation_jobs, 003_used_payments. Next is 004.

What is MISSING and is the subject of this Phase 1:
- Final QA Gate: no lib/dcl/gates/, no Opus gatekeeper, no verdict, no loop guard, no gate->deliver branch.
- Context Store: no 004 migration, no persistence; context items are lost on page refresh.
- A first-class Mock/Fixture Mode so the whole pipeline can be tested with zero API spend.

Confirmed architectural defaults (carry these into the implementation):
- D1. Gate model = Opus 4.8, read from env DCL_GATE_MODEL (default "claude-opus-4-8"). Switchable to Sonnet.
- D2. On FAIL after the cycle cap (default 2) -> force-pass with a visible warning banner. Never block a paying client.
- D3. Context Store Phase 1 scope = durability + audit (write-only). Cross-session RETRIEVAL is Phase 2.
       Design the schema and the store interface so the read path can be added in Phase 2 WITHOUT a migration change.

--------------------------------------------------------------------------------

## 1. Scope

In scope (Phase 1):
- A. Final QA Gate (generic loop-policy core + Opus worker + adapter wiring + orchestrator branch + UI banner).
- B. Context Store (migration 004 + generic store interface + Supabase impl + persist route + write checkpoints).
- C. Mock/Fixture Mode (env-driven deterministic fixtures for every agent + deterministic gate verdicts + in-memory store).
- D. Boundary discipline: keep lib/dcl/ free of all Agent Studio / Web3 / document vocabulary; add a grep-proof test.

Out of scope (Phase 2, do not build now):
- Context Store READ path / cross-session context retrieval / merge logic.
- Any change to the existing extractor / classify / package logic beyond what Sections A-C require.
- New document types or prompt content changes.

--------------------------------------------------------------------------------

## 2. Component A -- Final QA Gate

### 2.1 Design split (important)

The gate has three responsibilities, deliberately separated to respect the boundary:

1. Judgment (LLM): does the final document pass acceptance? -> a background worker on Opus. Domain-aware.
2. Loop policy (deterministic): given a verdict and the current cycle, what action and is it a forced pass?
   -> a PURE function in the generic core lib/dcl/gates/. Domain-agnostic, model-agnostic, trivially unit-tested.
3. Orchestration: hold the cycle counter across job invocations, call worker, call policy, branch the UI.
   -> the browser orchestrator (run/page.tsx), because the loop spans multiple background jobs.

Rationale: the loop (gate -> revise -> gate) spans more than one job, so the cycle count is orchestrator state.
The generic core never calls a model and never knows what "Web3" or "Tech Spec" means.

### 2.2 Generic core: lib/dcl/gates/

New files:
- lib/dcl/gates/types.ts
- lib/dcl/gates/gate.ts
- lib/dcl/gates/gate.test.ts   (unit tests, see 2.8)

types.ts contract (ASCII; these are the authoritative shapes):

```
export type GateVerdict = "pass" | "pass_with_minor_fixes" | "fail";

export type GateAction = "deliver" | "deliver_with_warning" | "revise";

// One actionable issue the judge raised. Opaque to the core beyond these fields.
export interface GateFinding {
  severity: RiskLevel;        // reuse RiskLevel from ../types
  message: string;
  applies_to?: string[];      // opaque role/section labels, never enumerated by the core
}

// Raw judgment returned by the (injected) evaluator / worker.
export interface GateJudgment {
  verdict: GateVerdict;
  findings: GateFinding[];
  summary: string;
}

// Loop policy configuration (domain supplies the numbers).
export interface GatePolicy {
  maxCycles: number;          // default 2; after this many FAILs we force-pass
}

// Deterministic decision derived from a judgment + the current cycle.
export interface GateDecision {
  verdict: GateVerdict;
  action: GateAction;
  forcePassed: boolean;       // true when we deliver despite an unresolved FAIL at the cap
  cycle: number;              // 0-based index of the gate run that produced this decision
  findings: GateFinding[];
  summary: string;
}
```

gate.ts contract -- ONE pure function (no async, no fetch, no model):

```
export function decideGateAction(
  judgment: GateJudgment,
  cycle: number,            // how many times the gate has already run in this generation (0 on first run)
  policy: GatePolicy,
): GateDecision;
```

Decision table (implement exactly this):

| verdict                 | cycle < maxCycles            | cycle >= maxCycles                         |
|-------------------------|------------------------------|--------------------------------------------|
| pass                    | action=deliver               | action=deliver                             |
| pass_with_minor_fixes   | action=deliver_with_warning  | action=deliver_with_warning                |
| fail                    | action=revise                | action=deliver_with_warning, forcePassed=true |

Notes:
- forcePassed is true ONLY in the bottom-right cell (fail at/after cap).
- pass_with_minor_fixes always delivers; it surfaces notes but never loops. forcePassed stays false.
- The function is total and deterministic. No I/O. This is the unit under test in 2.8.

### 2.3 Worker: lib/agents/finalQa.ts (domain-aware judgment)

New file. Mirrors the shape of lib/agents/critic.ts and architect.ts (non-streaming Anthropic call,
returns { data, meta }). This is where the model and the Web3 acceptance criteria live.

- Model: read process.env.DCL_GATE_MODEL, default "claude-opus-4-8".
- Pricing for meta.costUsd: Opus 4.8 = $5.00 / $25.00 per MTok input/output. If DCL_GATE_MODEL is a Sonnet
  string, use $3.00 / $15.00. Implement a small lookup keyed by model prefix; default to Opus rates.
- Export: export async function generateFinalQa(apiKey: string, input: FinalQaInput): Promise<GenerationResult>
  reuse GenerationResult / GenerationMeta from lib/agents/generate.ts.

FinalQaInput:
```
export interface FinalQaInput {
  techSpec: unknown;                 // the final (post-revise) document JSON
  intakeData: Record<string, string>;
  documentType?: string;
  researchReport?: unknown;
  acceptanceCriteria: string[];      // supplied by the adapter from BaseContext.outputRequirements
  unresolvedFlags: string[];         // content strings of any still-review_required context items
  contextPackage?: string;           // DCL package rendered for role "final_qa" (additive, may be "")
}
```

Worker output (the worker returns this as result.data; it is the raw GateJudgment plus nothing else):
```
{
  "verdict": "pass" | "pass_with_minor_fixes" | "fail",
  "findings": [ { "severity": "low|medium|high|critical", "message": "string", "applies_to": ["..."] } ],
  "summary": "one-paragraph acceptance summary"
}
```

System prompt responsibilities (the gate is an ACCEPTANCE check, not a rewrite):
- Judge the final document against: the acceptance criteria, the unresolved high-risk flags, internal
  consistency, and whether any hard quantitative/market claim is unsourced.
- Return "fail" only for blocking defects (unsupported hard numbers left in, contradictions, a required
  section missing or empty, a criterion clearly unmet).
- Return "pass_with_minor_fixes" for non-blocking polish that does not justify another full revise cycle.
- Return "pass" when the document is client-ready.
- Output STRICT JSON only (reuse the json-repair parse path used by the other agents).

Reuse the existing non-streaming Anthropic call style and json-repair.parseJsonLoose from lib/agents.

### 2.4 Adapter wiring: lib/dcl-adapter.ts

Add a thin helper that builds FinalQaInput.acceptanceCriteria and the DCL package for role "final_qa".
Keep ALL Web3/document specifics here, not in lib/dcl/gates/.

Add:
```
export const DCL_GATE_MAX_CYCLES =
  Number(process.env.DCL_GATE_MAX_CYCLES ?? "2");

export function finalQaAcceptanceCriteria(base: BaseContext): string[] {
  // Phase 1: reuse base.outputRequirements verbatim; this is the contract the gate checks against.
  return base.outputRequirements;
}
```
Re-export the gate core surface through the adapter so app code has one import surface, consistent with
how ENABLE_DCL / ContextItem are already re-exported:
```
export { decideGateAction } from "./dcl/gates/gate";
export type { GateDecision, GateVerdict, GateJudgment, GateAction, GateFinding, GatePolicy } from "./dcl/gates/types";
```

### 2.5 Background dispatch: netlify/functions/generate-background.ts

Add the new job kind alongside the existing ones:
```
import { generateFinalQa, type FinalQaInput } from "../../lib/agents/finalQa";
...
} else if (job.kind === "final_qa") {
  result = await generateFinalQa(apiKey, job.input as FinalQaInput);
}
```
No other change to the dispatcher. The worker returns { data: GateJudgment, meta }.

Also confirm /api/generate/start accepts kind === "final_qa" (it should already be generic; if it has an
allowlist of kinds, add "final_qa").

### 2.6 Orchestrator integration: app/run/page.tsx

Add a Step 4 (Final QA Gate) that runs UNCONDITIONALLY before download/deliver:
after Revise when Revise ran, directly after the review stage when it did not.
No path may reach download/deliver without a GateDecision.

AMENDMENT (approved): Revise trigger is: numeric QA score < 9.2 (parse the score as a
number, never compare as strings; with integer scores this means 9 -> revise, 10 -> skip).
Revise also runs whenever the gate returns action="revise", regardless of score.

State to add:
- gateCycle: number (0 initially; increment each time the gate runs)
- gateDecision: GateDecision | null
- a status value "final_qa_checking" and a terminal-ish "gate_done"

Flow (pseudocode, implement in the existing runJob/packageFor style already in the file):
```
async function runFinalQa() {
  if (!ENABLE_DCL) { /* skip gate entirely, go straight to deliverable */ return; }
  setStatus("final_qa_checking");

  const base = baseContextFromIntake(form);
  const finalPackage = packageFor("final_qa", contextItems);
  const unresolvedFlags = contextItems
    .filter(i => i.status === "review_required")
    .map(i => i.content);

  const { data, meta } = await runJob("final_qa", {
    techSpec: spec,
    intakeData: form,
    documentType: form.documentNeeds,
    researchReport: researchResult,
    acceptanceCriteria: finalQaAcceptanceCriteria(base),
    unresolvedFlags,
    contextPackage: finalPackage,
  });

  const judgment = data as GateJudgment;
  const decision = decideGateAction(judgment, gateCycle, { maxCycles: DCL_GATE_MAX_CYCLES });
  setGateDecision(decision);

  // persist the gate run + snapshot (see Section B checkpoint G)
  await persistGateRun(decision, meta);

  if (decision.action === "revise") {
    setGateCycle(gateCycle + 1);
    await runRevise();      // existing function
    await runFinalQa();     // re-gate; loop guard in decideGateAction guarantees termination
    return;
  }
  // action === "deliver" || "deliver_with_warning": stop here, document is releasable
  setStatus("gate_done");
}
```

UI:
- When decision.action === "deliver_with_warning" (including forcePassed===true), render a non-blocking
  warning banner above the document: show decision.summary and the high/critical findings. The Download PDF
  button remains enabled in all deliver* cases (D2: never block a paying client).
- When action === "deliver", no banner.
- Keep the existing deliver/download path unchanged.

Wire runFinalQa() to run automatically after revise in the normal happy path, OR behind an existing
"continue" affordance -- match whatever the current revise->document UX is. Do not regress the manual flow.

### 2.7 Verdict contract summary

Worker (Opus) returns GateJudgment. Core decideGateAction maps (judgment, cycle, policy) -> GateDecision.
Orchestrator acts on GateDecision.action. This three-step contract is the heart of Component A.

### 2.8 Tests for Component A

- lib/dcl/gates/gate.test.ts (pure, no network):
  - pass at cycle 0 -> deliver, forcePassed=false
  - pass_with_minor_fixes at cycle 0 and at cycle >= max -> deliver_with_warning, forcePassed=false
  - fail at cycle 0 with maxCycles=2 -> revise
  - fail at cycle 1 with maxCycles=2 -> revise
  - fail at cycle 2 with maxCycles=2 -> deliver_with_warning, forcePassed=true  (the loop terminates)
  - verify total termination: feeding fail repeatedly never returns "revise" once cycle >= maxCycles.

--------------------------------------------------------------------------------

## 3. Component B -- Context Store (durability + audit, write-only)

### 3.1 Migration: supabase/migrations/004_dcl_store.sql

Four tables matching the generic vocabulary already declared in lib/dcl/types.ts
(ContextItem, AgentRun, Artifact, ContextSnapshot). Prefix as_dcl_ to match the existing as_ convention
(as_generation_jobs, as_used_payments). All tables carry a generation_id grouping key (the Phase 2
retrieval key), an opaque metadata jsonb, and domain_tags text[]. NO Web3/document columns -- domain data
rides in metadata/domain_tags only.

Authoritative DDL:

```
-- 004_dcl_store.sql
create table if not exists as_dcl_context_items (
  id            text primary key,                 -- the ctx_NNNN id from classify.ts (unique per generation)
  generation_id uuid not null,
  type          text not null,
  content       text not null,
  source_agent  text not null,
  status        text not null,
  risk_level    text not null,
  confidence    double precision not null default 0.5,
  applies_to    text[] not null default '{}',
  reason        text,
  metadata      jsonb,
  domain_tags   text[] not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists idx_dcl_items_gen on as_dcl_context_items (generation_id);

create table if not exists as_dcl_agent_runs (
  id                  uuid primary key default gen_random_uuid(),
  generation_id       uuid not null,
  agent_role          text not null,
  status              text not null,
  context_package_id  text,
  output_artifact_id  text,
  metadata            jsonb,
  domain_tags         text[] not null default '{}',
  created_at          timestamptz not null default now()
);
create index if not exists idx_dcl_runs_gen on as_dcl_agent_runs (generation_id);

create table if not exists as_dcl_artifacts (
  id            uuid primary key default gen_random_uuid(),
  generation_id uuid not null,
  content       jsonb not null,                   -- opaque (document json, gate judgment, etc.)
  metadata      jsonb,
  domain_tags   text[] not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists idx_dcl_artifacts_gen on as_dcl_artifacts (generation_id);

create table if not exists as_dcl_context_snapshots (
  id               uuid primary key default gen_random_uuid(),
  generation_id    uuid not null,
  version          integer not null,
  stage            text not null,                 -- opaque stage label, e.g. agent role or "seed"/"gate"
  context_item_ids text[] not null default '{}',
  metadata         jsonb,
  domain_tags      text[] not null default '{}',
  created_at       timestamptz not null default now()
);
create index if not exists idx_dcl_snapshots_gen on as_dcl_context_snapshots (generation_id);
```

Note on id collision: classify.ts uses an in-session counter (ctx_0001...) reset per generation via
__resetSeq(). Because the primary key must be globally unique across generations, store context items with a
COMPOUND uniqueness of (generation_id, id) instead of id alone if you keep the short ids. Either:
  (a) change the as_dcl_context_items PK to (generation_id, id), OR
  (b) prefix the stored id with the generation_id at persist time.
Choose (a) -- it keeps the in-app id untouched and the boundary clean. Update the DDL PK accordingly.

### 3.2 Generic store interface: lib/dcl/store.ts (NEW, domain-agnostic)

The pure core defines the interface and an in-memory implementation (used by tests and mock mode).
It MUST NOT import Supabase or any Agent Studio module.

```
import type { ContextItem, AgentRun, Artifact, ContextSnapshot } from "./types";

export interface ContextStore {
  saveContextItems(generationId: string, items: ContextItem[]): Promise<void>;
  appendAgentRun(generationId: string, run: AgentRun): Promise<void>;
  saveArtifact(generationId: string, artifact: Artifact): Promise<string>;   // returns artifact id
  saveSnapshot(generationId: string, snapshot: ContextSnapshot): Promise<void>;
  // Phase 2 (declare now, do not implement): loadLatest(generationId): Promise<...>
}

export class InMemoryContextStore implements ContextStore { /* trivial Map-backed impl */ }
```

### 3.3 Supabase implementation: lib/dcl-store-supabase.ts (NEW, adapter side -- NOT in lib/dcl/)

Domain/infra binding. Knows the as_dcl_* table names. Implements ContextStore using the SAME direct
Supabase REST (fetch) pattern already used in generate-background.ts (do NOT use @supabase/supabase-js;
the WebSocket init crashes on Node 20). Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

```
export class SupabaseContextStore implements ContextStore { ... }   // implements via REST upsert/insert
```

This file lives next to lib/dcl-adapter.ts, NOT inside lib/dcl/, so the core stays pure.

### 3.4 Persistence route: apps/web/app/api/dcl/persist/route.ts (NEW)

The browser orchestrator cannot hold the service-role key, so persistence goes through a server route.
- POST body: { generationId, items?, run?, artifact?, snapshot? } (any subset; batch-friendly).
- Server-side: instantiate the store (SupabaseContextStore by default; InMemory if DCL_STORE=memory, see C),
  write whatever subset was provided, return { ok: true } or { ok: false, error }.
- Failures here MUST NOT break generation: the orchestrator treats persist errors as non-fatal (log + continue).
  Durability is best-effort in Phase 1; a paying client must still get the document.

### 3.5 Orchestrator write checkpoints: app/run/page.tsx

Mint one generationId (crypto.randomUUID()) at pipeline start; thread it through all persist calls.
Write (best-effort, awaited but caught) at these checkpoints:

- Checkpoint S (seed): after seedBaseContextItems -> persist items + snapshot(stage="seed", version=0).
- Checkpoint W (writer): after writer extract merge -> persist new items + snapshot(stage="writer", v=1).
- Checkpoint R (reviewers): after qa/critic/architect extract merge -> persist new items + snapshot(stage="review", v=2).
- Checkpoint V (revise): CONDITIONAL -- written only when Revise actually ran ->
  persist snapshot(stage="revise", v++) (+ artifact = revised doc, optional).
- Checkpoint G is UNCONDITIONAL: once per gate invocation, on every generation.
- Checkpoint G (gate): after each gate run -> persist agent_run(role="final_qa", status=verdict) + artifact = GateJudgment
  + snapshot(stage="gate", v++). This is persistGateRun() referenced in 2.6.

Each snapshot's context_item_ids = the ids of contextItems in state at that moment.
version increments monotonically within a generation.

### 3.6 Phase 2 hooks (declare, do not build)

- ContextStore.loadLatest(generationId) is declared but not implemented (throw "not implemented in Phase 1").
- generation_id is already the grouping/retrieval key, so Phase 2 read path needs no migration change.
- Do not add any read endpoint or UI for retrieval now.

### 3.7 Tests for Component B

- InMemoryContextStore round-trip unit test (save items/run/artifact/snapshot, assert stored).
- A persist-route test using DCL_STORE=memory: POST a batch, assert ok and that the in-memory store received it.
- Do NOT write a test that requires a live Supabase; the Supabase impl is covered by mock-mode E2E manually.

--------------------------------------------------------------------------------

## 4. Component C -- Mock / Fixture Mode (first-class, zero API spend)

Goal: run the ENTIRE pipeline (research -> writer -> reviewers -> revise -> gate -> persist) and exercise
the gate loop, force-pass, and Context Store writes WITHOUT calling Anthropic and WITHOUT paid credit.

### 4.1 Env flags

- AS_MOCK = "1" | "0" (default "0"): when "1", every agent worker returns a fixture instead of calling Anthropic.
- DCL_GATE_MOCK_VERDICT = "pass" | "pass_with_minor_fixes" | "fail" (optional): when AS_MOCK=1, force the gate
  worker to return this verdict, so the loop guard and force-pass are deterministically testable.
  If unset, gate mock returns "pass".
- DCL_STORE = "supabase" | "memory" (default "supabase"): when "memory", the persist route uses
  InMemoryContextStore (no Supabase credentials needed at all).

With AS_MOCK=1 and DCL_STORE=memory, the app needs NO Anthropic key and NO Supabase to run a full cycle.

### 4.2 Fixtures

New dir: apps/web/lib/agents/fixtures/
- research.json    (shape of generateResearch result.data)
- writer.json      (a valid 10-section TechSpec document JSON, matches OUTPUT_STRUCTURE in generate.ts)
- critic.json      (Critic JSON shape)
- architect.json   (Architect JSON shape)
- revise.json      (a valid TechSpec, ideally a lightly-different writer.json so "revised" is visible)
- finalqa-pass.json
- finalqa-minor.json
- finalqa-fail.json

Fixtures must be valid against the same parsers the real outputs use (json-repair / the document renderer),
so a mock run renders a real PDF end to end.

### 4.3 Worker short-circuit

In each worker (generateResearch, generateWriter, generateCritic, generateArchitect, generateRevise,
generateFinalQa): at the top, if process.env.AS_MOCK === "1", load and return the corresponding fixture as
{ data: fixture, meta: { agentName, durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 } }.
Implement this once as a tiny helper (e.g. lib/agents/mock.ts: maybeMock(agentName)) and call it at the
top of each worker to avoid duplication.

For generateFinalQa specifically: when AS_MOCK=1, pick the fixture by DCL_GATE_MOCK_VERDICT
(pass -> finalqa-pass.json, fail -> finalqa-fail.json, etc.). This is what makes the loop testable:
set DCL_GATE_MOCK_VERDICT=fail to watch gate -> revise -> gate hit the cap and force-pass.

### 4.4 Mock-mode acceptance (manual E2E, documented in README or a short MOCK.md)

With AS_MOCK=1, DCL_STORE=memory, ENABLE_DCL=true:
- A full run completes and renders a PDF with no Anthropic/Supabase credentials.
- DCL_GATE_MOCK_VERDICT=pass  -> no banner, action=deliver.
- DCL_GATE_MOCK_VERDICT=fail  -> exactly DCL_GATE_MAX_CYCLES revise cycles, then a warning banner
  (forcePassed=true), document still downloadable.
- The in-memory store has snapshots for seed/writer/review/revise/gate stages.

--------------------------------------------------------------------------------

## 5. Boundary discipline (mandatory)

lib/dcl/ (including the new lib/dcl/gates/ and lib/dcl/store.ts) MUST remain domain-agnostic:
- No imports from lib/dcl-adapter.ts, lib/agents/*, app/*, Supabase, or any Web3/document concept.
- No domain words. The new gate/store code must not contain: web3, token, tokenomics, defi, audit, blockchain,
  proofflow, antlab, pdfshift, "tech spec", supabase, anthropic, claude, opus, sonnet.

Add a boundary-proof test (CI-friendly), e.g. a script or a test that runs:

```
grep -rinE 'web3|tokenomic|defi|audit|blockchain|proofflow|antlab|pdfshift|tech ?spec|supabase|anthropic|claude|opus|sonnet' apps/web/lib/dcl/ && exit 1 || exit 0
```

It must pass (find nothing). The Supabase store (lib/dcl-store-supabase.ts) is intentionally OUTSIDE lib/dcl/,
so it is exempt. Document this grep in the test file header.

--------------------------------------------------------------------------------

## 6. Environment variables (summary)

New / used by this phase (add to .env.example with comments, no secrets):
- DCL_GATE_MODEL        default "claude-opus-4-8"     (gate judge model; set a Sonnet string to cut cost)
- DCL_GATE_MAX_CYCLES   default "2"                   (FAIL->revise loop cap before force-pass)
- AS_MOCK               default "0"                   ("1" => fixtures, no Anthropic calls)
- DCL_GATE_MOCK_VERDICT default unset                 ("pass"|"pass_with_minor_fixes"|"fail" under AS_MOCK)
- DCL_STORE             default "supabase"            ("memory" => InMemoryContextStore, no Supabase needed)
- (existing) NEXT_PUBLIC_ENABLE_DCL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

--------------------------------------------------------------------------------

## 7. Acceptance criteria (what "done" means)

1. lib/dcl/gates/{types,gate}.ts exist; decideGateAction matches the 2.2 decision table; gate.test.ts passes.
2. lib/agents/finalQa.ts exists; generateFinalQa uses DCL_GATE_MODEL (default Opus 4.8); returns GateJudgment.
3. generate-background.ts dispatches kind "final_qa"; /api/generate/start accepts it.
4. run/page.tsx runs the gate after revise, loops on FAIL up to the cap, force-passes with a non-blocking
   warning banner, never disables Download in any deliver* case.
5. 004_dcl_store.sql creates the four as_dcl_* tables (PK (generation_id, id) on context items).
6. lib/dcl/store.ts (interface + InMemoryContextStore) and lib/dcl-store-supabase.ts (Supabase impl) exist.
7. /api/dcl/persist writes best-effort; persist failures never abort a generation.
8. Orchestrator writes snapshots at seed/writer/review/revise/gate checkpoints with a single generationId.
9. Mock mode: AS_MOCK=1 + DCL_STORE=memory runs a full cycle and renders a PDF with NO Anthropic/Supabase
   credentials; DCL_GATE_MOCK_VERDICT=fail produces exactly maxCycles loops then a force-pass banner.
10. Boundary grep test passes (lib/dcl/ contains no domain/infra vocabulary).
11. Existing pre-DCL behaviour is unchanged when NEXT_PUBLIC_ENABLE_DCL=false (gate skipped, no persist).
12. Build is green; no @supabase/supabase-js added; Node 20 background functions still run.

--------------------------------------------------------------------------------

## 8. Suggested file manifest

New:
- apps/web/lib/dcl/gates/types.ts
- apps/web/lib/dcl/gates/gate.ts
- apps/web/lib/dcl/gates/gate.test.ts
- apps/web/lib/dcl/store.ts
- apps/web/lib/dcl-store-supabase.ts
- apps/web/lib/agents/finalQa.ts
- apps/web/lib/agents/mock.ts
- apps/web/lib/agents/fixtures/*.json
- apps/web/app/api/dcl/persist/route.ts
- supabase/migrations/004_dcl_store.sql
- apps/web/MOCK.md  (or a README section): how to run mock mode

Changed:
- apps/web/lib/dcl-adapter.ts            (gate re-exports, DCL_GATE_MAX_CYCLES, finalQaAcceptanceCriteria)
- apps/web/netlify/functions/generate-background.ts   (dispatch "final_qa")
- apps/web/app/api/generate/start/route.ts            (allow "final_qa" if an allowlist exists)
- apps/web/app/run/page.tsx              (gate step, loop, banner, generationId, persist checkpoints)
- apps/web/.env.example                  (new vars)
- each lib/agents/*.ts worker            (maybeMock short-circuit at top)

--------------------------------------------------------------------------------

## 9. Handoff notes for Claude Code

- Build in the repo, run the unit tests and the boundary grep, then commit. No ZIP, no manual patching.
- Keep diffs minimal and additive; the gate and store are opt-in via ENABLE_DCL and env flags.
- Do not change extractor/classify/package logic except where Sections A-C explicitly require.
- If any interface here conflicts with the real code you see in the repo, prefer the repo's actual shapes
  and flag the discrepancy in the commit message rather than forcing this spec's names.
- After implementation, the author (architecture chat) will review: boundary integrity, the decision-table
  correctness, mock-mode determinism, and that a paying client is never blocked by a FAIL.

-- end of spec --
