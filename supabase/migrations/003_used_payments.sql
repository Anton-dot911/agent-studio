-- Anti-replay ledger for B2C document payments.
--
-- Each successful USDC payment (tx hash) may unlock exactly ONE generation.
-- The generate/start route inserts the hash here after onchain verification;
-- the UNIQUE constraint makes a second attempt with the same hash fail, so a
-- paid transaction cannot be reused to generate multiple documents for free.

create table if not exists as_used_payments (
  tx_hash      text primary key,
  payer        text,
  amount       text,
  job_id       uuid,
  created_at   timestamptz not null default now()
);

-- Lookup by payer for support / analytics (optional).
create index if not exists as_used_payments_payer_idx on as_used_payments (payer);
