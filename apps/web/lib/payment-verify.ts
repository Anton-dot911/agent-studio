// Server-side verification that a USDC payment actually happened onchain.
//
// The B2C flow has the user pay $1 USDC via Coinbase Smart Wallet (sendCalls).
// Before we spend money running Sonnet, the server confirms the transaction:
//   1. exists and succeeded onchain
//   2. is a USDC Transfer to OUR payment address
//   3. is for at least the required amount
//
// Anti-replay (one tx -> one generation) is enforced separately in the
// generate/start route via the `as_used_payments` table.

import { createPublicClient, http, parseUnits, decodeEventLog, erc20Abi } from "viem";
import { ACTIVE_CHAIN, USDC_ADDRESS as USDC_ADDRESS_RAW, DEFAULT_PAYMENT_ADDRESS, RPC_URL } from "./network";

// -- Network config ------------------------------------------------------------
// Chain, USDC contract, and RPC all switch together off NEXT_PUBLIC_USE_MAINNET
// (see lib/network). Nothing chain-specific is hardcoded here.
export { ACTIVE_CHAIN };

// Lowercased for case-insensitive log comparison below.
export const USDC_ADDRESS = USDC_ADDRESS_RAW.toLowerCase();

// The Agent Studio payout / payments address. Override with PAYMENT_ADDRESS;
// defaults to the shared Agent Studio wallet.
export const PAYMENT_ADDRESS = (
  process.env.PAYMENT_ADDRESS ?? DEFAULT_PAYMENT_ADDRESS
).toLowerCase();

// Required amount in USDC (6 decimals). Default $1.
export const REQUIRED_USDC = process.env.DOC_PRICE_USDC ?? "1";

const client = createPublicClient({
  chain: ACTIVE_CHAIN,
  transport: http(RPC_URL),
});

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  from?: string;
  amount?: bigint;
}

// Verify a transaction hash represents a valid USDC payment to PAYMENT_ADDRESS.
export async function verifyUsdcPayment(txHash: string): Promise<VerifyResult> {
  // Basic shape check before hitting RPC.
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, reason: "Malformed transaction hash" };
  }

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    // Not yet mined or unknown to this RPC.
    return { ok: false, reason: "Transaction not found or not yet confirmed" };
  }

  if (receipt.status !== "success") {
    return { ok: false, reason: "Transaction did not succeed onchain" };
  }

  const required = parseUnits(REQUIRED_USDC, 6);

  // Scan the logs for a USDC Transfer event into our address.
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== USDC_ADDRESS) continue;

    let decoded;
    try {
      decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }

    if (decoded.eventName !== "Transfer") continue;

    const args = decoded.args as { from: string; to: string; value: bigint };
    if (args.to.toLowerCase() !== PAYMENT_ADDRESS) continue;

    if (args.value < required) {
      return {
        ok: false,
        reason: `Underpaid: got ${args.value} base units, need ${required}`,
        from: args.from.toLowerCase(),
        amount: args.value,
      };
    }

    // Valid USDC Transfer to us for >= required amount.
    return { ok: true, from: args.from.toLowerCase(), amount: args.value };
  }

  return { ok: false, reason: "No matching USDC transfer to payment address in this tx" };
}
