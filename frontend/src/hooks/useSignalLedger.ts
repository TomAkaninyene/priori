import { useCallback, useEffect, useState } from "react";
import { signalLedger } from "../lib/contract";
import type { Signal, Stats } from "../lib/types";

export type LedgerStatus = "loading" | "error" | "ready";

interface LedgerState {
  status: LedgerStatus;
  signals: Signal[];
  stats: Stats | null;
  error: string | null;
}

interface RawSignal {
  id: bigint;
  token: string;
  direction: bigint;
  score: bigint;
  entryPrice: bigint;
  stopPrice: bigint;
  targetPrice: bigint;
  publishedAt: bigint;
  expiresAt: bigint;
  resolved: boolean;
  outcome: bigint;
  exitPrice: bigint;
  resolvedAt: bigint;
}

interface RawStats {
  totalPublished: bigint;
  totalResolved: bigint;
  wins: bigint;
  losses: bigint;
  unresolvedExpired: bigint;
}

function toSignal(raw: RawSignal): Signal {
  return {
    id: raw.id,
    token: raw.token,
    direction: Number(raw.direction),
    score: Number(raw.score),
    entryPrice: raw.entryPrice,
    stopPrice: raw.stopPrice,
    targetPrice: raw.targetPrice,
    publishedAt: raw.publishedAt,
    expiresAt: raw.expiresAt,
    resolved: raw.resolved,
    outcome: Number(raw.outcome),
    exitPrice: raw.exitPrice,
    resolvedAt: raw.resolvedAt,
  };
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.shortMessage === "string") {
      return anyErr.shortMessage;
    }
    if (typeof anyErr.message === "string") {
      return anyErr.message;
    }
  }
  return "Failed to load signals from chain";
}

const initialState: LedgerState = { status: "loading", signals: [], stats: null, error: null };

export function useSignalLedger() {
  const [state, setState] = useState<LedgerState>(initialState);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState((prev) => ({ ...prev, status: "loading", error: null }));
      try {
        const [stats, countRaw] = (await Promise.all([
          signalLedger.getStats(),
          signalLedger.getSignalCount(),
        ])) as [RawStats, bigint];

        const count = Number(countRaw);
        // Newest first: ids are sequential starting at 1, so descending id
        // order is exactly chronological descending order.
        const ids = Array.from({ length: count }, (_, index) => BigInt(count - index));
        const rawSignals = (await Promise.all(ids.map((id) => signalLedger.getSignal(id)))) as RawSignal[];

        if (cancelled) {
          return;
        }
        setState({
          status: "ready",
          signals: rawSignals.map(toSignal),
          stats,
          error: null,
        });
      } catch (err) {
        if (cancelled) {
          return;
        }
        setState({ status: "error", signals: [], stats: null, error: extractErrorMessage(err) });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return { ...state, refresh };
}
