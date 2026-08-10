import { ethers } from "ethers";
import type { Signal } from "./types";

export function formatPrice(scaled: bigint): string {
  return ethers.formatUnits(scaled, 8);
}

export function formatTimestamp(seconds: bigint): string {
  if (seconds === 0n) {
    return "—";
  }
  const date = new Date(Number(seconds) * 1000);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function directionLabel(direction: number): string {
  return direction === 1 ? "Short" : "Long";
}

export function outcomeLabel(outcome: number): string {
  switch (outcome) {
    case 1:
      return "Target Hit";
    case 2:
      return "Stop Hit";
    case 3:
      return "Expired";
    default:
      return "—";
  }
}

export type SignalStatus = "Resolved" | "Pending" | "Expired";

export function signalStatus(signal: Signal, nowSeconds: number): SignalStatus {
  if (signal.resolved) {
    return "Resolved";
  }
  return Number(signal.expiresAt) < nowSeconds ? "Expired" : "Pending";
}
