// Read-only mirror of contracts/SignalLedger.sol's public interface. Kept to
// exactly the view functions this frontend calls -- no write functions, this
// app never sends transactions.
export const SIGNAL_LEDGER_ABI = [
  "function getSignal(uint256 id) view returns (tuple(uint256 id, string token, uint8 direction, uint8 score, uint256 entryPrice, uint256 stopPrice, uint256 targetPrice, uint256 publishedAt, uint256 expiresAt, bool resolved, uint8 outcome, uint256 exitPrice, uint256 resolvedAt))",
  "function getSignalCount() view returns (uint256)",
  "function getStats() view returns (uint256 totalPublished, uint256 totalResolved, uint256 wins, uint256 losses, uint256 unresolvedExpired)",
] as const;
