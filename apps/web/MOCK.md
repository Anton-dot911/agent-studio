# Mock / Fixture Mode & the Final QA Gate

DCL v2 Phase 1 ships a first-class **mock mode** so the entire pipeline
(research → writer → reviewers → revise → **Final QA Gate** → persist) can be
exercised with **zero API spend** and, optionally, **no Supabase** at all.

## How it works

There are two layers, sharing one deterministic fixture set
(`lib/agents/fixtures/*.json`):

1. **Server worker short-circuit** — when `AS_MOCK=1`, each agent worker
   (`generateResearch/Writer/Critic/Architect/Revise/FinalQa` and the QA route)
   returns its fixture instead of calling Anthropic. The job still flows through
   the normal Netlify background function + Supabase job table.
2. **Client bypass** — when `NEXT_PUBLIC_AS_MOCK=1`, the browser orchestrator
   returns fixtures directly and **skips the job plumbing entirely** (no
   `/api/generate/start`, no polling). Combined with `DCL_STORE=memory`, a full
   run needs **no Anthropic key and no Supabase**.

The gate fixture is chosen by verdict so the loop guard and force-pass are
deterministic:

| `DCL_GATE_MOCK_VERDICT` | fixture               | gate behaviour                          |
| ----------------------- | --------------------- | --------------------------------------- |
| `pass` (default)        | `finalqa-pass.json`   | `deliver`, no banner                    |
| `pass_with_minor_fixes` | `finalqa-minor.json`  | `deliver_with_warning`, banner, no loop |
| `fail`                  | `finalqa-fail.json`   | `revise` up to the cap, then force-pass |

## Run a full cycle with no credentials

Set these (e.g. in `.env.local`), then start the app and run a generation:

```bash
NEXT_PUBLIC_ENABLE_DCL=true
AS_MOCK=1
NEXT_PUBLIC_AS_MOCK=1
DCL_STORE=memory
```

Expected results (acceptance, spec §4.4):

- A full run completes and renders a real PDF with **no** Anthropic/Supabase
  credentials.
- `NEXT_PUBLIC_DCL_GATE_MOCK_VERDICT=pass` → no banner, action `deliver`.
- `NEXT_PUBLIC_DCL_GATE_MOCK_VERDICT=fail` → exactly `DCL_GATE_MAX_CYCLES`
  revise cycles, then a non-blocking **warning banner** (`forcePassed=true`);
  the Download button stays enabled the whole time (a paying client is never
  blocked).
- The in-memory Context Store receives snapshots for the
  `seed` / `writer` / `review` / `revise` / `gate` stages.

> Set both `AS_MOCK` and `NEXT_PUBLIC_AS_MOCK` (and both `*_GATE_MOCK_VERDICT`
> variants) when you want the server QA route and the client bypass to agree.

## Tests

```bash
npm test              # pure unit tests: gate loop policy + store + persist path
npm run test:boundary # asserts lib/dcl/ contains no domain/infra vocabulary
npm run test:all      # both
```

The gate loop policy (`lib/dcl/gates/gate.ts`) is a pure function with a full
decision-table test proving the `gate → revise → gate` loop always terminates
at the cap.
