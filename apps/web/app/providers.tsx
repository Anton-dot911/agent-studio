"use client";
import { OnchainKitProvider } from "@coinbase/onchainkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { coinbaseWallet } from "wagmi/connectors";
import { type ReactNode } from "react";
import { base, baseSepolia } from "viem/chains";
import { ACTIVE_CHAIN } from "../lib/network";

// Chain switches base <-> baseSepolia off NEXT_PUBLIC_USE_MAINNET (see lib/network).
// Transports are declared for both ids; ACTIVE_CHAIN alone decides which is live.
const wagmiConfig = createConfig({
  chains: [ACTIVE_CHAIN],
  connectors: [coinbaseWallet({ appName: "Agent Studio", preference: "smartWalletOnly" })],
  transports: { [base.id]: http(), [baseSepolia.id]: http() },
  ssr: true,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <OnchainKitProvider
          apiKey={process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY}
          chain={ACTIVE_CHAIN}
          config={{ appearance: { mode: "auto" } }}
        >
          {children}
        </OnchainKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
