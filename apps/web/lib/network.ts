// Single source of truth for the payment network.
//
// Flip NEXT_PUBLIC_USE_MAINNET=true to move the ENTIRE app from Base Sepolia to
// Base mainnet in one place. The viem chain, USDC contract, x402 network slug,
// RPC endpoint, and human-readable label all switch together off this one flag,
// so a chain and its USDC address can never drift apart. No address or chain is
// hardcoded anywhere else — client (lib/payment.ts, app/providers.tsx), server
// (lib/payment-verify.ts), and proxy (proxy.ts) all import from here.

import { base, baseSepolia } from "viem/chains";

// The single switch. NEXT_PUBLIC_ so both the browser and the server read it.
export const USE_MAINNET = process.env.NEXT_PUBLIC_USE_MAINNET === "true";

// viem chain object (used by wagmi / OnchainKit / the RPC client).
export const ACTIVE_CHAIN = USE_MAINNET ? base : baseSepolia;

// USDC contract per network (6 decimals). Coinbase-issued test USDC on Sepolia.
const USDC_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const USDC_ADDRESS = (USE_MAINNET ? USDC_MAINNET : USDC_SEPOLIA) as `0x${string}`;

// x402 network slug (proxy / paymentMiddleware).
export const X402_NETWORK = USE_MAINNET ? "base" : "base-sepolia";

// Human-readable network name for UI copy.
export const NETWORK_LABEL = USE_MAINNET ? "Base" : "Base Sepolia";

// Default recipient — the Agent Studio wallet. Every recipient env var
// (NEXT_PUBLIC_PAYMENT_ADDRESS / PAYMENT_ADDRESS / X402_PAYMENT_ADDRESS) falls
// back to this same address so the payout target lives in exactly one place.
export const DEFAULT_PAYMENT_ADDRESS =
  "0x8250231307A1Aa9cfd47e7be9258D5eF49fc83FF" as `0x${string}`;

// RPC endpoint. Defaults to the public Base RPC for the active network; override
// with BASE_RPC_URL (CDP / Alchemy / Infura) for reliability in production.
export const RPC_URL =
  process.env.BASE_RPC_URL ??
  (USE_MAINNET ? "https://mainnet.base.org" : "https://sepolia.base.org");
