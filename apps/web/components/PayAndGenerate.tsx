"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useSendCalls, useWaitForCallsStatus } from "wagmi";
import { coinbaseWallet } from "wagmi/connectors";
import { builderCodeCapability } from "../lib/builder-code";
import { buildUsdcTransferCall, DOC_PRICE_USDC } from "../lib/payment";

type PayState = "idle" | "connecting" | "paying" | "confirming" | "paid" | "error";

interface PayAndGenerateProps {
  onPaid: () => void;
  disabled?: boolean;
}

export function PayAndGenerate({ onPaid, disabled }: PayAndGenerateProps) {
  const { isConnected } = useAccount();
  const { connect, isPending: isConnecting } = useConnect();
  const { sendCalls, data: callsResult, isPending: isSending, error: sendError } = useSendCalls();
  const [state, setState] = useState<PayState>("idle");
  const [errMsg, setErrMsg] = useState("");
  // true when we should fire sendCalls as soon as wallet is connected
  const [pendingPay, setPendingPay] = useState(false);

  const { data: callsStatus, isLoading: isConfirming } = useWaitForCallsStatus({
    id: callsResult?.id,
    query: { enabled: !!callsResult?.id },
  });

  // After wallet connects, fire the deferred payment
  useEffect(() => {
    if (isConnected && pendingPay) {
      setPendingPay(false);
      sendPayment();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, pendingPay]);

  // Fire onPaid exactly once when the batch confirms.
  useEffect(() => {
    if (callsStatus?.status === "success" && state !== "paid") {
      setState("paid");
      onPaid();
    }
  }, [callsStatus?.status, state, onPaid]);

  function sendPayment() {
    setState("paying");
    try {
      sendCalls({
        calls: [buildUsdcTransferCall()],
        capabilities: builderCodeCapability,
      });
      setState("confirming");
    } catch (e) {
      setState("error");
      setErrMsg(e instanceof Error ? e.message : "Payment failed");
    }
  }

  function handleClick() {
    setErrMsg("");
    if (!isConnected) {
      setState("connecting");
      setPendingPay(true);
      connect({
        connector: coinbaseWallet({ appName: "Agent Studio", preference: "smartWalletOnly" }),
      });
    } else {
      sendPayment();
    }
  }

  const busy = isConnecting || isSending || isConfirming || state === "connecting" || state === "confirming" || state === "paying";
  const error = errMsg || sendError?.message;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button
        onClick={handleClick}
        disabled={disabled || busy || state === "paid"}
        style={{
          borderRadius: 12,
          padding: "14px 20px",
          fontSize: 15,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: disabled || busy ? "default" : "pointer",
          background: state === "paid" ? "#16a34a" : "#0055b3",
          color: "#fff",
          border: "none",
          opacity: disabled || busy ? 0.7 : 1,
        }}
      >
        {state === "paid"
          ? "Payment confirmed"
          : state === "connecting" || isConnecting
            ? "Connecting wallet..."
            : busy
              ? "Processing..."
              : !isConnected
                ? `Connect wallet & pay $${DOC_PRICE_USDC} USDC`
                : `Pay $${DOC_PRICE_USDC} USDC & generate`}
      </button>

      {error && (
        <p style={{ color: "#dc2626", fontSize: 13, margin: 0 }}>{error.slice(0, 160)}</p>
      )}

      <p style={{ color: "#6b7280", fontSize: 11, margin: 0 }}>
        Base Sepolia &middot; attributed to Builder Code bc_ndv5qw7g
      </p>
    </div>
  );
}
