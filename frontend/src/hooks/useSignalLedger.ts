import { useCallback, useEffect, useState } from "react";
import { signalLedger } from "../lib/contract";
import type { Signal, Stats } from "../lib/types";

export type LedgerStatus = "loading" | "error" | "ready";

interface LedgerState {
  status: LedgerStatus;
  signals: Signal[];
  stats: Stats | null;
  error: string | null;
  lastUpdated: Date | null;
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

function toSignal(raw: RawSignal, notesById: Map<string, string>): Signal {
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
    note: notesById.get(raw.id.toString()) ?? "",
  };
}

// Notes only ever exist in SignalPublished's event data (see abi.ts), never
// in the struct getSignal() returns, so they have to be read from logs
// separately. This is supplementary, not core ledger data -- if the RPC
// can't serve the log query (some providers cap eth_getLogs block ranges),
// the dashboard should still render every signal's real on-chain fields
// with blank notes rather than fail outright.
async function fetchNotesById(): Promise<Map<string, string>> {
  const notesById = new Map<string, string>();
  try {
    const events = await signalLedger.queryFilter(signalLedger.filters.SignalPublished());
    for (const event of events) {
      if ("args" in event && event.args) {
        notesById.set((event.args.id as bigint).toString(), event.args.note as string);
      }
    }
  } catch (err) {
    console.warn("Could not read signal notes from SignalPublished logs:", err);
  }
  return notesById;
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

const initialState: LedgerState = { status: "loading", signals: [], stats: null, error: null, lastUpdated: null };

export function useSignalLedger() {
  const [state, setState] = useState<LedgerState>(initialState);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState((prev) => ({ ...prev, status: "loading", error: null }));
      try {
        const [stats, countRaw, notesById] = await Promise.all([
          signalLedger.getStats() as Promise<RawStats>,
          signalLedger.getSignalCount() as Promise<bigint>,
          fetchNotesById(),
        ]);

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
          signals: rawSignals.map((raw) => toSignal(raw, notesById)),
          stats,
          error: null,
          lastUpdated: new Date(),
        });
      } catch (err) {
        if (cancelled) {
          return;
        }
        setState((prev) => ({ status: "error", signals: [], stats: null, error: extractErrorMessage(err), lastUpdated: prev.lastUpdated }));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return { ...state, refresh };
}
