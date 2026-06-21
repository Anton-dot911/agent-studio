import { paymentMiddleware } from "x402-next";

const RECIPIENT = (process.env.X402_PAYMENT_ADDRESS ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const proxy = paymentMiddleware(RECIPIENT, {
  "/api/v1/generate": {
    price: "$1",
    network: "base-sepolia",
    config: {
      description: "Generate a full Web3 document (Tech Spec / Tokenomics / DeFi Audit)",
    },
  },
});

export const config = {
  matcher: ["/api/v1/:path*"],
};
