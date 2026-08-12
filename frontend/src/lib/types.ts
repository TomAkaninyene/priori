export const DIRECTION_SHORT = 1;
export const DIRECTION_LONG = 2;

export const OUTCOME_TARGET_HIT = 1;
export const OUTCOME_STOP_HIT = 2;
export const OUTCOME_EXPIRED = 3;

export interface Signal {
  id: bigint;
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
  // SignalPublished event logs. Empty string if the signal was published
  // without a note, or if the note couldn't be read (e.g. the RPC doesn't
  // have logs this old).
  note: string;
}

export interface Stats {
  totalPublished: bigint;
  totalResolved: bigint;
  wins: bigint;
  losses: bigint;
  unresolvedExpired: bigint;
}
