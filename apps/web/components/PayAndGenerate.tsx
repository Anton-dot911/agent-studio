"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useSendCalls, useWaitForCallsStatus } from "wagmi";
import { coinbaseWallet } from "wagmi/connectors";
import { builderCodeCapability } from "../lib/builder-code";
import { buildUsdcTransferCall, DOC_PRICE_USDC } from "../lib/payment";

type PayState = "idle" | "paying" | "confirming" | "paid" | "error";

interface PayAndGenerateProps {
  // Called once payment is confirmed onchain, with the settled transaction hash.
  // The server re-verifies this hash before running generation.
  onPaid: (txHash: string) => void;
  disabled?: boolean;
}

// In-app Base USDC payment that carries the Builder Code (ERC-8021) dataSuffix so
// the transaction is attributed to bc_ndv5qw7g, then hands the settled tx hash to
// onPaid() for server-side verification.
export function PayAndGenerate({ onPaid, disabled }: PayAndGenerateProps) {
  const { isConnected } = useAccount();
  const { connect, isPending: isConnecting } = useConnect();
  const { sendCalls, data: callsResult, isPending: isSending, error: sendError } = useSendCalls();
  const [state, setState] = useState<PayState>("idle");
  const [errMsg, setErrMsg] = useState("");
  // Set when the user clicks before the wallet is connected; triggers the
  // payment automatically once connection completes.
  const [pendingPay, setPendingPay] = useState(false);

  // Single subscription that tracks the batch until it is mined.
  const { data: callsStatus, isLoading: isConfirming } = useWaitForCallsStatus({
    id: callsResult?.id,
    query: { enabled: !!callsResult?.id },
  });

  function pay() {
    setState("paying");
    sendCalls({
      calls: [buildUsdcTransferCall()],
      capabilities: builderCodeCapability,
    });
    setState("confirming");
  }

  // Once the wallet connects after a queued click, fire the payment.
  useEffect(() => {
    if (pendingPay && isConnected) {
      setPendingPay(false);
      pay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPay, isConnected]);

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

  function handlePay() {
    setErrMsg("");
    try {
      if (!isConnected) {
        setPendingPay(true);
        connect({
          connector: coinbaseWallet({ appName: "Agent Studio", preference: "smartWalletOnly" }),
        });
        return;
      }
      pay();
    } catch (e) {
      setState("error");
      setErrMsg(e instanceof Error ? e.message : "Payment failed");
    }
  }

  const busy = isConnecting || isSending || isConfirming || state === "confirming" || pendingPay;
  const error = errMsg || sendError?.message;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button
        onClick={handlePay}
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
        Attributed to Builder Code bc_ndv5qw7g
      </p>
    </div>
  );
}
