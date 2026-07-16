import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import { USDC_ADDRESS, DEFAULT_PAYMENT_ADDRESS } from "./network";

// USDC contract + chain switch together off NEXT_PUBLIC_USE_MAINNET (see lib/network).
export const USDC_CONTRACT = USDC_ADDRESS;

// Document price in USDC.
export const DOC_PRICE_USDC = "1" as const;

// Recipient (the Agent Studio payout / payments address). Override with
// NEXT_PUBLIC_PAYMENT_ADDRESS; defaults to the shared Agent Studio wallet.
export const PAYMENT_ADDRESS = (process.env.NEXT_PUBLIC_PAYMENT_ADDRESS ??
  DEFAULT_PAYMENT_ADDRESS) as `0x${string}`;

// Build a single ERC-20 transfer call for sendCalls().
// The Builder Code dataSuffix is attached at the sendCalls() capabilities level,
// not here, so this stays a clean standard transfer.
export function buildUsdcTransferCall(
  to: `0x${string}` = PAYMENT_ADDRESS,
  amount: string = DOC_PRICE_USDC,
) {
  return {
    to: USDC_CONTRACT,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, parseUnits(amount, 6)],
    }),
  };
}
