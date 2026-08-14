export const DIRECTION_SHORT = 1;
export const DIRECTION_LONG = 2;

export const OUTCOME_TARGET_HIT = 1;
export const OUTCOME_STOP_HIT = 2;
export const OUTCOME_EXPIRED = 3;

export type SignalVersion = "v1" | "v2";

export interface Signal {
  id: bigint;
  version: SignalVersion;
  token: string;
  direction: number;
  score: number;
  entryPrice: bigint;
  stopPrice: bigint;
  targetPrice: bigint;
  publishedAt: bigint;
  expiresAt: bigint;
  resolved: boolean;
  outcome: number;
  exitPrice: bigint;
  resolvedAt: bigint;
  // Not part of the on-chain Signal struct -- read separately from
  // SignalPublished event logs. Empty string if the note couldn't be read,
  // or if the signal has no note to read in the first place: v1's
  // SignalPublished predates the note param entirely, so every v1 signal
  // is empty here regardless of RPC availability.
  note: string;
}

export interface Stats {
  totalPublished: bigint;
  totalResolved: bigint;
  wins: bigint;
  losses: bigint;
  unresolvedExpired: bigint;
}
