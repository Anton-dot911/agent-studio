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
import { base, baseSepolia } from "viem/chains";

// -- Network config ------------------------------------------------------------
// Flip USE_MAINNET (env) to move from Sepolia to mainnet. The USDC address and
// chain switch together so they can never drift apart.
const USE_MAINNET = process.env.NEXT_PUBLIC_USE_MAINNET === "true";

export const ACTIVE_CHAIN = USE_MAINNET ? base : baseSepolia;

// USDC contract per network.
const USDC_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const USDC_ADDRESS = (USE_MAINNET ? USDC_MAINNET : USDC_SEPOLIA).toLowerCase();

// Your Builder Code payout / payments address.
export const PAYMENT_ADDRESS = (
  process.env.PAYMENT_ADDRESS ?? "0x21fbb46e2e0eb4c2079ed387585217705d30e082"
).toLowerCase();

// Required amount in USDC (6 decimals). Default $1.
export const REQUIRED_USDC = process.env.DOC_PRICE_USDC ?? "1";

// RPC endpoint. Defaults to the public Base RPC; override with BASE_RPC_URL
// (CDP / Alchemy / Infura) for reliability and rate-limit headroom in production.
const RPC_URL =
  process.env.BASE_RPC_URL ??
  (USE_MAINNET ? "https://mainnet.base.org" : "https://sepolia.base.org");

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
