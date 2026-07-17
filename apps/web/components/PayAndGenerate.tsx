"use client";

import { useEffect, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSendCalls,
  useSwitchChain,
  useWaitForCallsStatus,
} from "wagmi";
import { coinbaseWallet } from "wagmi/connectors";
import { builderCodeCapability } from "../lib/builder-code";
import { buildUsdcTransferCall, DOC_PRICE_USDC } from "../lib/payment";
import { ACTIVE_CHAIN, NETWORK_LABEL } from "../lib/network";

type PayState = "idle" | "switching" | "paying" | "confirming" | "paid" | "error";

interface PayAndGenerateProps {
  // Called once payment is confirmed onchain, with the settled transaction hash.
  // The server re-verifies this hash before running generation.
  onPaid: (txHash: string) => void;
  disabled?: boolean;
}

// The one connector we ever connect with — Coinbase Smart Wallet only.
const connector = coinbaseWallet({ appName: "Agent Studio", preference: "smartWalletOnly" });

// 0x1234…abcd
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

// Map raw viem / wallet errors to a friendly one-liner.
function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|rejected the request|user denied|\b4001\b/i.test(msg)) {
    return "Request rejected in your wallet.";
  }
  if (/chain|network|switch/i.test(msg)) {
    return `Please switch your wallet to ${NETWORK_LABEL} and try again.`;
  }
  return msg.slice(0, 160);
}

// In-app Base USDC payment that carries the Builder Code (ERC-8021) dataSuffix so
// the transaction is attributed to bc_ndv5qw7g, then hands the settled tx hash to
// onPaid() for server-side verification.
export function PayAndGenerate({ onPaid, disabled }: PayAndGenerateProps) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { sendCalls, data: callsResult, isPending: isSending, error: sendError } = useSendCalls();
  const [state, setState] = useState<PayState>("idle");
  const [errMsg, setErrMsg] = useState("");

  // Single subscription that tracks the batch until it is mined.
  const { data: callsStatus, isLoading: isConfirming } = useWaitForCallsStatus({
    id: callsResult?.id,
    query: { enabled: !!callsResult?.id },
  });

  async function pay() {
    setErrMsg("");
    try {
      // Guard: the connected wallet may be on a stale chain (e.g. after a network
      // flip or an auto-reconnected session). Switch it to the active chain before
      // building calls so we never send to the wrong network.
      if (chainId !== ACTIVE_CHAIN.id) {
        setState("switching");
        await switchChainAsync({ chainId: ACTIVE_CHAIN.id });
      }
      setState("paying");
      // Pin the target chain explicitly (hardening against the earlier `d.id`
      // crash where the batch had no resolved chain after a network flip).
      sendCalls({
        chainId: ACTIVE_CHAIN.id,
        calls: [buildUsdcTransferCall()],
        capabilities: builderCodeCapability,
      });
      setState("confirming");
    } catch (e) {
      setState("error");
      setErrMsg(friendlyError(e));
    }
  }

  function handleConnect() {
    setErrMsg("");
    setState("idle");
    connect({ connector });
  }

  function handleDisconnect() {
    setErrMsg("");
    setState("idle");
    // Clears the active connection and wagmi's persisted session, so the next
    // Connect prompts for account selection instead of silently reusing the old one.
    disconnect();
  }

  // Fire onPaid exactly once when the batch confirms, passing the tx hash.
  useEffect(() => {
    if (callsStatus?.status === "success" && state !== "paid") {
      const txHash = callsStatus.receipts?.[0]?.transactionHash;
      if (!txHash) {
        setState("error");
        setErrMsg("Payment confirmed but no transaction hash was returned");
        return;
      }
      setState("paid");
      onPaid(txHash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callsStatus?.status, state]);

  const busy =
    isSending || isConfirming || state === "switching" || state === "paying" || state === "confirming";
  const error = errMsg || (sendError ? friendlyError(sendError) : "");

  // Shared button style helper.
  const primaryBtn = (bg: string): React.CSSProperties => ({
    borderRadius: 12,
    padding: "14px 20px",
    fontSize: 15,
    fontWeight: 600,
    fontFamily: "inherit",
    background: bg,
    color: "#fff",
    border: "none",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {isConnected && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "#374151",
              background: "#f3f4f6",
              borderRadius: 8,
              padding: "6px 10px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
            title={address}
          >
            {short(address)}
          </span>
          <button
            onClick={handleDisconnect}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: "inherit",
              color: "#6b7280",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "6px 4px",
              textDecoration: "underline",
            }}
          >
            Disconnect
          </button>
        </div>
      )}

      {isConnected ? (
        <button
          onClick={pay}
          disabled={disabled || busy || state === "paid"}
          style={{
            ...primaryBtn(state === "paid" ? "#16a34a" : "#0055b3"),
            cursor: disabled || busy || state === "paid" ? "default" : "pointer",
            opacity: disabled || busy ? 0.7 : 1,
          }}
        >
          {state === "paid"
            ? "Payment confirmed"
            : state === "switching"
              ? `Switching to ${NETWORK_LABEL}…`
              : busy
                ? "Processing..."
                : `Pay $${DOC_PRICE_USDC} USDC & generate`}
        </button>
      ) : (
        <button
          onClick={handleConnect}
          disabled={disabled || isConnecting}
          style={{
            ...primaryBtn("#0055b3"),
            cursor: disabled || isConnecting ? "default" : "pointer",
            opacity: disabled || isConnecting ? 0.7 : 1,
          }}
        >
          {isConnecting ? "Connecting..." : "Connect wallet"}
        </button>
      )}

      {error && (
        <p style={{ color: "#dc2626", fontSize: 13, margin: 0 }}>{error}</p>
      )}

      <p style={{ color: "#6b7280", fontSize: 11, margin: 0 }}>
        Attributed to Builder Code bc_ndv5qw7g
      </p>
    </div>
  );
}
