# Context Layer: Verifiable Work for the Agent Economy

Concept document -- AntLab / Agent Studio
Status: Level 1 shipped and verified on Base mainnet. Levels 2-3 proposed.

--------------------------------------------------------------------------------

## 1. The problem nobody has priced in yet

The agent economy has a payment rail (x402: agents paying agents in USDC on
Base) but no trust rail. When module A pays module B for work -- a research
report, a code review, a data extraction -- the only quality signal available
today is B's self-assessment. That is not a market; that is faith.

Three failure modes make autonomous work-for-hire unreliable at any scale:

1. Unverified claims propagate. One module states a figure without a source;
   every downstream module treats it as fact.
2. Context is lost or bloated between modules. Each step either misses
   decisions made earlier or drowns in unfiltered history.
3. Nothing independent guards the output. The producer grades its own work,
   and the buyer has no audit trail to dispute against.

Human freelance markets solved this with escrow, review, and reputation.
The machine-to-machine work market has none of these primitives. We are
building the context and verification layer that provides them.

## 2. The product: a multi-level context layer

Not a multi-agent framework. An infrastructure layer that any modular
system -- agentic or not -- can plug into, with three levels:

LEVEL 1 -- Verified context within one job (SHIPPED)
  - Every module's output passes through extraction and deterministic
    classification: operational context is auto-accepted; high-impact claims
    are flagged and never passed downstream as fact; unsupported claims are
    rejected.
  - Each module receives a role-scoped context package, not raw history.
  - A mandatory quality gate (an independent, stronger judge model) evaluates
    the final output against acceptance criteria before release. Verdicts:
    pass / pass with notes / fail with a capped self-correction loop. The
    buyer is never blocked; a defect is never silent.
  - Every step writes a durable, queryable audit trail: context snapshots,
    gate verdicts, judgments.

LEVEL 2 -- Context across sessions and passes (SCHEMA-READY)
  - Complex deliverables are not produced in one pass. An implementation
    blueprint is assembled module by module, each pass consuming verified
    context from previous passes and from previous engagements.
  - This is what raises the complexity ceiling of automated work: from a
    6-page specification (a $200-350 job) to a 30-page implementation
    blueprint (a $2,000+ job). The economics of the layer scale with the
    complexity of work it makes reliable.
  - The Level 1 store is already keyed for this (generation_id grouping);
    the read path needs no schema migration.

LEVEL 3 -- Context across systems and owners (PROPOSED)
  - When the buyer and seller are different systems, the context layer
    becomes the trust primitive: an x402 payment references a job whose
    gate verdict and audit trail are independently checkable.
  - Concretely: pay-per-work where "work" means "output that passed an
    independent gate, with the trail to prove it" -- not the seller's word.
  - This is the missing counterpart to the payment rail Base already has.

## 3. What is already shipped and verifiable (built with zero funding)

Level 1 is not a plan. It runs in production inside Agent Studio, our
document-generation platform (the first application of the layer):

- Live deployment: agent-studio.netlify.app -- a multi-module pipeline
  (research, writer, three parallel reviewers, revision, final gate)
  producing paid technical documents.
- First mainnet-verified paid job: $1.00 USDC on Base, tx
  0x45f7613e28d427b6cca2546048cb421c27b1e7b6d31a63b1053e55e277998769,
  Builder Code attributed (bc_ndv5qw7g), anti-replay enforced server-side.
- Verified end-to-end traces in the database for both gate branches:
  fail -> capped revision loop -> force-pass with visible warning (client
  never blocked), and pass -> immediate release. Full snapshot trail
  (seed -> writer -> review -> [revise] -> gate) per generation.
- Deterministic fixture mode: the entire pipeline, including the gate loop
  and the audit trail, runs reproducibly with zero model spend and zero
  credentials. A reviewer can verify our claims in minutes.
- Clean architecture: the context layer core is domain-agnostic (enforced
  by a CI boundary test); all application specifics live in one adapter.
  Lifting the layer into another pipeline means writing a new adapter,
  not a rewrite.
- Documentation: docs/DCL.md (architecture and verified traces),
  apps/web/MOCK.md (reproduce our results), 12 unit tests, typed end to end.

Repository: github.com/Anton-dot911/agent-studio

## 4. Honest positioning

Parts of this space are occupied, and we name them: agent memory layers
(MemGPT/Letta lineage) persist conversational state; orchestration
frameworks (LangGraph and peers) manage module graphs and handoffs. What we
have not found anywhere is the combination that matters for paid work:

  independent quality gate + durable audit trail + onchain payment
  referencing the verified job.

Memory without verification propagates errors faster. Orchestration without
an audit trail gives the buyer nothing to dispute against. Our bet is that
the trust primitive -- not the graph engine -- is the scarce piece of the
agent economy, and it is naturally Base-native because the payment rail it
completes already lives here.

## 5. Roadmap and what support buys

LEVEL 2 (est. 2-3 months, solo builder + model/infra costs)
  - Read path and cross-pass retrieval on the existing schema; RLS policies.
  - Multi-pass assembly: blueprint-class deliverables composed module by
    module from verified context.
  - Measurable target: ship a 25+ page implementation blueprint produced
    by the pipeline and accepted by a paying client; publish the full
    audit trail alongside it.

LEVEL 3 (est. 3-4 months, after Level 2)
  - Job manifest: a compact, signed record binding an x402 payment to a
    gate verdict and trail hash, checkable by the buyer.
  - Reference integration: one external module/agent selling work through
    the layer (x402 Bazaar listing), with disputes resolvable against the
    trail.
  - Measurable target: first machine-to-machine paid job where the buyer
    verified the gate verdict before releasing payment.

Support requested: Builder Grant (retroactive, for shipped Level 1) as the
entry point; Level 2-3 scope sized for ecosystem-track follow-up. Funds go
to model/inference costs for development and evaluation, infrastructure,
and the builder's focused time.

## 6. Why Base

- The payment rail this layer completes is x402 on Base. We are already a
  live x402 merchant with Builder Code attribution on mainnet.
- Base's agent-economy thesis needs verifiable work to be more than a
  payments demo. We are building the verification half.
- Everything we ship is reproducible by the committee at zero cost
  (fixture mode) and checkable onchain (Basescan) -- shipped code over
  pitch, in the spirit of Builder Grants.

Contact: AntLab (Anton) -- github.com/Anton-dot911 -- agent-studio.netlify.app
