// Read-only mirror of contracts/SignalLedger.sol's public interface. Kept to
// exactly the view functions this frontend calls -- no write functions, this
// app never sends transactions.
//
// getSignal/getSignalCount/getStats are identical between v1 (the legacy
// contract) and v2 (current) -- only SignalPublished differs, since v1
// predates the note field entirely (see CLAUDE.md "Deployed contracts").
const SIGNAL_LEDGER_VIEW_ABI = [
  "function getSignal(uint256 id) view returns (tuple(uint256 id, string token, uint8 direction, uint8 score, uint256 entryPrice, uint256 stopPrice, uint256 targetPrice, uint256 publishedAt, uint256 expiresAt, bool resolved, uint8 outcome, uint256 exitPrice, uint256 resolvedAt))",
  "function getSignalCount() view returns (uint256)",
  "function getStats() view returns (uint256 totalPublished, uint256 totalResolved, uint256 wins, uint256 losses, uint256 unresolvedExpired)",
] as const;

export const SIGNAL_LEDGER_ABI = [
  ...SIGNAL_LEDGER_VIEW_ABI,
  // Notes are never stored in the Signal struct (see getSignal above) -- the
  // only place a signal's note ever exists on-chain is this event's data,
  // so it has to be read from logs rather than from a view call. v1 has no
  // note param at all, so this event shape is v2-only.
  "event SignalPublished(uint256 indexed id, string token, uint8 direction, uint8 score, uint256 entryPrice, uint256 stopPrice, uint256 targetPrice, uint256 publishedAt, uint256 expiresAt, string note)",
] as const;

// v1 predates the note field, so its interface has no SignalPublished note
// to read -- view functions only.
export const SIGNAL_LEDGER_V1_ABI = SIGNAL_LEDGER_VIEW_ABI;
