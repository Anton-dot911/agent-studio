import { encodeFunctionData, erc20Abi, parseUnits } from "viem";

// USDC on Base Sepolia (6 decimals). Coinbase-issued test USDC.
export const USDC_BASE_SEPOLIA =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`;

// Document price in USDC.
export const DOC_PRICE_USDC = "1" as const;

// Recipient (your Builder Code payout / payments address).
export const PAYMENT_ADDRESS =
  "0x21fbb46e2e0eb4c2079ed387585217705d30e082" as `0x${string}`;

// Build a single ERC-20 transfer call for sendCalls().
// The Builder Code dataSuffix is attached at the sendCalls() capabilities level,
// not here, so this stays a clean standard transfer.
export function buildUsdcTransferCall(
  to: `0x${string}` = PAYMENT_ADDRESS,
  amount: string = DOC_PRICE_USDC,
) {
  return {
    to: USDC_BASE_SEPOLIA,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, parseUnits(amount, 6)],
    }),
  };
}
