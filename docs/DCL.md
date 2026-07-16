# Dynamic Context Layer (DCL)

Quality control infrastructure for multi-agent document generation.
Built for Agent Studio, designed as a reusable, domain-agnostic core.

## The problem

Multi-agent pipelines fail quietly. When several AI agents hand work to each
other (research -> writer -> reviewers -> revision), three things go wrong in
practice:

1. Unverified claims propagate. An agent states a market figure without a
   source; downstream agents treat it as fact; it ends up in a client PDF.
2. Context is lost or bloated. Each agent either misses decisions made
   earlier or gets the entire history dumped into its prompt.
3. Nothing guards the exit. The last agent's self-assessment decides whether
   the output ships. If it is wrong, the client gets a defective document.

DCL addresses all three with a controlled context layer between agents and a
mandatory quality gate before delivery.

## What it does

1. Context extraction and classification. After each agent runs, a
   lightweight extractor pulls out decisions, constraints, assumptions, and
   claims. A deterministic policy classifies each item:

   - auto_accepted -- safe operational context (constraints, decisions)
   - review_required -- high-impact claims that must not be treated as fact
     (for example an unsourced market figure)
   - rejected -- unsupported claims, never passed downstream as context

2. Role-scoped context packages. Each agent receives a rendered package
   tailored to its role -- the writer sees constraints and accepted
   decisions; reviewers additionally see flagged items. No agent receives
   raw, unfiltered history.

3. Final QA Gate. Before any document reaches the client, a stronger
   judge model (configurable via env, default Claude Opus) evaluates the
   final document against acceptance criteria and unresolved flags. Verdicts:

   - pass -> deliver
   - pass_with_minor_fixes -> deliver with notes
   - fail -> automatic revision cycle, capped (default 2 cycles), after
     which the document is force-passed WITH a visible warning banner.
     A paying client is never blocked; a defect is never silent.

   The loop policy is a pure function with a proven decision table
   (unit-tested); the judge is swappable per deployment.

4. Context Store (audit trail). Every generation writes durable snapshots
   to Postgres (Supabase) at five checkpoints: seed, writer, review, each
   revision, each gate run. Every gate verdict and judgment is persisted.
   The result is a complete, queryable audit trail of how a document was
   produced and what quality decisions were made along the way.

## Verified end to end

The full pipeline was verified on the live deployment using deterministic
fixture mode (zero model spend), with the trace confirmed in the database.

Fail path (gate verdict forced to "fail"):

```
stage:    seed -> writer -> review -> revise -> gate -> revise -> gate -> revise -> gate
version:   0        1         2         3        4        5        6        7        8
```

- 3 final_qa runs recorded: fail, fail, fail with forcePassed=true
- 3 gate judgments persisted as artifacts
- UI shows a warning banner; download remains available (client not blocked)
- Total cycle time ~100 seconds, $0.0000 model spend

Pass path (gate verdict "pass"):

```
stage:    seed -> writer -> review -> revise -> gate (stop)
```

- exactly 1 final_qa run, status=pass, no banner, immediate delivery

Both traces are reproducible: set AS_MOCK=1, DCL_STORE=memory (or supabase),
DCL_GATE_MOCK_VERDICT=fail|pass and run a generation. No Anthropic or
Supabase credentials are required in memory mode. See MOCK.md.

## Architecture: a clean boundary

The DCL core (lib/dcl/) is strictly domain-agnostic:

- no imports from the application, no vendor SDKs, no Web3 or document
  vocabulary -- enforced by a grep-based boundary test in CI
- classification policy, packaging rules, gate decision table, and the
  store interface are pure TypeScript with unit tests
- all Agent Studio specifics (Web3 document types, acceptance criteria,
  model choice, Supabase persistence) live in a single adapter layer
  (lib/dcl-adapter.ts, lib/dcl-store-supabase.ts)

This means DCL can be lifted into any multi-agent pipeline -- not only
document generation -- by writing a new adapter.

## Why this matters for the Base ecosystem

Agent Studio uses x402 micropayments on Base for pay-per-document access
(Builder Code attributed). As autonomous agents increasingly pay other
agents for work, the missing piece is verifiable quality: an agent that
pays USDC for a deliverable needs more than the seller's self-assessment.

DCL is that piece: an independent gatekeeper, a capped self-correction
loop, and a durable audit trail per paid job. Phase 2 (cross-session
context retrieval; the schema is already keyed for it) extends this into
agent memory across engagements.

## Status

- Phase 1 shipped and verified in production (gate, store, mock mode).
- 12 unit tests, boundary check, type check, and build green.
- Phase 2 (read path / cross-session retrieval) is schema-ready:
  generation_id is the grouping key; no migration needed to add reads.
