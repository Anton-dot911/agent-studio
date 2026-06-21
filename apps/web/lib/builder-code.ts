// Base Builder Code attribution (ERC-8021)
//
// Registry ID (base.dev): bc_ndv5qw7g
// Payout address (base.dev settings): 0x21fbb46e2e0eb4c2079ed387585217705d30e082
//
// This dataSuffix is appended to the calldata of onchain transactions so Base
// indexers can attribute the activity to this app. Smart contracts ignore the
// trailing bytes; only offchain indexers read them. Negligible gas (16 gas per
// non-zero byte).
//
// Verify attribution at https://base.dev (Onchain -> Total Transactions) or with
// https://builder-code-checker.vercel.app/ using a tx hash.

export const BUILDER_CODE_ID = "bc_ndv5qw7g" as const;

// Pre-encoded ERC-8021 dataSuffix obtained from base.dev (Settings -> Builder Code).
// Decodes to: "bc_ndv5qw7g" + ERC-8021 marker bytes (8021 repeating).
export const BUILDER_CODE_SUFFIX =
  "0x62635f6e647635717737670b0080218021802180218021802180218021" as `0x${string}`;

// The dataSuffix capability object for ERC-5792 wallets (Coinbase Smart Wallet).
// Pass this into sendCalls({ capabilities }). `optional: true` means the call
// still succeeds on wallets that do not support the capability.
export const builderCodeCapability = {
  dataSuffix: {
    value: BUILDER_CODE_SUFFIX,
    optional: true,
  },
} as const;
