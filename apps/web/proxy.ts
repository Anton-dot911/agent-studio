import { paymentMiddleware } from "x402-next";
import { X402_NETWORK, DEFAULT_PAYMENT_ADDRESS } from "./lib/network";

// Recipient for x402 payments. Override with X402_PAYMENT_ADDRESS; defaults to
// the shared Agent Studio wallet.
const RECIPIENT = (process.env.X402_PAYMENT_ADDRESS ?? DEFAULT_PAYMENT_ADDRESS) as `0x${string}`;

export const proxy = paymentMiddleware(RECIPIENT, {
  "/api/v1/generate": {
    // Network switches base <-> base-sepolia off NEXT_PUBLIC_USE_MAINNET (see lib/network).
    price: "$1",
    network: X402_NETWORK,
    config: {
      description: "Generate a full Web3 document (Tech Spec / Tokenomics / DeFi Audit)",
    },
  },
});

export const config = {
  matcher: ["/api/v1/:path*"],
};
