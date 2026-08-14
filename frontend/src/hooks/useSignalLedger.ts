import { useCallback, useEffect, useState } from "react";
import { provider, signalLedgerV1, signalLedgerV2 } from "../lib/contract";
import type { Signal, SignalVersion, Stats } from "../lib/types";
import type { Contract } from "ethers";

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

interface VersionedRawSignal {
  raw: RawSignal;
  version: SignalVersion;
}

const EMPTY_NOTES: Map<string, string> = new Map();

function toSignal(raw: RawSignal, version: SignalVersion, notesById: Map<string, string>): Signal {
  return {
    id: raw.id,
    version,
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

function sumStats(a: RawStats, b: RawStats): Stats {
  return {
    totalPublished: a.totalPublished + b.totalPublished,
    totalResolved: a.totalResolved + b.totalResolved,
    wins: a.wins + b.wins,
    losses: a.losses + b.losses,
    unresolvedExpired: a.unresolvedExpired + b.unresolvedExpired,
  };
}

async function fetchContractSignals(contract: Contract, version: SignalVersion): Promise<VersionedRawSignal[]> {
  const countRaw = (await contract.getSignalCount()) as bigint;
  const count = Number(countRaw);
  const ids = Array.from({ length: count }, (_, index) => BigInt(count - index));
  const rawSignals = (await Promise.all(ids.map((id) => contract.getSignal(id)))) as RawSignal[];
  return rawSignals.map((raw) => ({ raw, version }));
}

// Notes only ever exist in v2's SignalPublished event data (see abi.ts),
// never in the struct getSignal() returns, so they have to be read from
// logs separately -- and only for v2, since v1's SignalPublished predates
// the note param entirely. This is supplementary, not core ledger data --
// if the RPC can't serve a log query, the dashboard should still render
// every signal's real on-chain fields with a blank note rather than fail
// outright.
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
      const events = await signalLedgerV2.queryFilter(signalLedgerV2.filters.SignalPublished(raw.id), fromBlock, toBlock);
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
        const [statsV1, statsV2, v1Signals, v2Signals] = await Promise.all([
          signalLedgerV1.getStats() as Promise<RawStats>,
          signalLedgerV2.getStats() as Promise<RawStats>,
          fetchContractSignals(signalLedgerV1, "v1"),
          fetchContractSignals(signalLedgerV2, "v2"),
        ]);
        // Notes only apply to v2 -- v1's SignalPublished has no note param.
        const notesById = await fetchNotesById(v2Signals.map(({ raw }) => raw));

        if (cancelled) {
          return;
        }

        const signals = [...v1Signals, ...v2Signals]
          .map(({ raw, version }) => toSignal(raw, version, version === "v2" ? notesById : EMPTY_NOTES))
          // Each signal keeps its own contract's on-chain publishedAt; ids
          // restart at 1 per contract, so chronological order (not id order)
          // is the only correct "newest first" across both.
          .sort((a, b) => (a.publishedAt === b.publishedAt ? 0 : a.publishedAt < b.publishedAt ? 1 : -1));

        setState({
          status: "ready",
          signals,
          stats: sumStats(statsV1, statsV2),
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
