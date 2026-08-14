import { useCallback, useEffect, useState } from "react";
import { provider, signalLedger } from "../lib/contract";
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
// can't serve a log query, the dashboard should still render every signal's
// real on-chain fields with a blank note rather than fail outright.
//
// An unbounded queryFilter (fromBlock 0 -> latest) is not an option here:
// X Layer's public RPC caps eth_getLogs at a 100-block range, while the
// chain is already tens of millions of blocks deep and this is an
// append-only ledger that only grows, so a full-history scan would never
// work. Instead, jump straight to each signal's block: publishedAt is set
// to block.timestamp at publish time (see SignalLedger.sol), and X Layer
// has an exact, fixed 1-second block time, so the target block can be
// computed from the current block/timestamp rather than searched for.
//
// The computed block should land exactly on the right one, but if it's ever
// off (block time drift, an off-by-one, a reorg) a silently blank note is
// worse than a slightly slower lookup -- so on a miss this widens the
// window and retries a couple of times, logging each widening, before
// giving up. The last level stays just under the RPC's 100-block cap.
const BLOCK_WINDOW_PADS = [3, 15, 49];

async function fetchNoteForSignal(
  raw: RawSignal,
  latestBlock: { number: number; timestamp: number },
): Promise<string | null> {
  const estimatedBlock = latestBlock.number - (latestBlock.timestamp - Number(raw.publishedAt));

  for (let level = 0; level < BLOCK_WINDOW_PADS.length; level++) {
    const pad = BLOCK_WINDOW_PADS[level];
    const fromBlock = Math.max(0, estimatedBlock - pad);
    const toBlock = Math.min(latestBlock.number, estimatedBlock + pad);
    try {
      const events = await signalLedger.queryFilter(signalLedger.filters.SignalPublished(raw.id), fromBlock, toBlock);
      const match = events.find((event) => "args" in event && event.args);
      if (match && "args" in match && match.args) {
        return match.args.note as string;
      }
      if (level < BLOCK_WINDOW_PADS.length - 1) {
        console.warn(
          `No SignalPublished event for signal ${raw.id} in block range ${fromBlock}-${toBlock} (estimated block ${estimatedBlock}), widening search to +/-${BLOCK_WINDOW_PADS[level + 1]} blocks`,
        );
      }
    } catch (err) {
      console.warn(`Could not query note for signal ${raw.id} in block range ${fromBlock}-${toBlock}:`, err);
      return null;
    }
  }

  console.warn(
    `Giving up on note for signal ${raw.id}: no SignalPublished event found within +/-${BLOCK_WINDOW_PADS[BLOCK_WINDOW_PADS.length - 1]} blocks of estimated block ${estimatedBlock}`,
  );
  return null;
}

async function fetchNotesById(rawSignals: RawSignal[]): Promise<Map<string, string>> {
  const notesById = new Map<string, string>();
  if (rawSignals.length === 0) {
    return notesById;
  }
  try {
    const latestBlock = await provider.getBlock("latest");
    if (!latestBlock) {
      return notesById;
    }

    await Promise.all(
      rawSignals.map(async (raw) => {
        const note = await fetchNoteForSignal(raw, latestBlock);
        if (note !== null) {
          notesById.set(raw.id.toString(), note);
        }
      }),
    );
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
        const [stats, countRaw] = await Promise.all([
          signalLedger.getStats() as Promise<RawStats>,
          signalLedger.getSignalCount() as Promise<bigint>,
        ]);

        const count = Number(countRaw);
        // Newest first: ids are sequential starting at 1, so descending id
        // order is exactly chronological descending order.
        const ids = Array.from({ length: count }, (_, index) => BigInt(count - index));
        const rawSignals = (await Promise.all(ids.map((id) => signalLedger.getSignal(id)))) as RawSignal[];
        const notesById = await fetchNotesById(rawSignals);

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
