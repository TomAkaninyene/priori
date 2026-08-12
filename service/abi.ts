// Hand-maintained mirror of contracts/SignalLedger.sol's public interface.
// Kept minimal to exactly the functions/events this service calls.
export const SIGNAL_LEDGER_ABI = [
  "function publishSignal(string token, uint8 direction, uint8 score, uint256 entryPrice, uint256 stopPrice, uint256 targetPrice, uint256 expiresAt, string note) returns (uint256 id)",
  "function publishSignal(string token, uint8 direction, uint8 score, uint256 entryPrice, uint256 stopPrice, uint256 targetPrice, string note) returns (uint256 id)",
  "function resolveSignal(uint256 id, uint8 outcome, uint256 exitPrice)",
  "function getSignal(uint256 id) view returns (tuple(uint256 id, string token, uint8 direction, uint8 score, uint256 entryPrice, uint256 stopPrice, uint256 targetPrice, uint256 publishedAt, uint256 expiresAt, bool resolved, uint8 outcome, uint256 exitPrice, uint256 resolvedAt))",
  "function getSignalCount() view returns (uint256)",
  "function getStats() view returns (uint256 totalPublished, uint256 totalResolved, uint256 wins, uint256 losses, uint256 unresolvedExpired)",
  "function MAX_NOTE_LENGTH() view returns (uint256)",
  "event SignalPublished(uint256 indexed id, string token, uint8 direction, uint8 score, uint256 entryPrice, uint256 stopPrice, uint256 targetPrice, uint256 publishedAt, uint256 expiresAt, string note)",
  "event SignalResolved(uint256 indexed id, uint8 outcome, uint256 exitPrice, uint256 resolvedAt)",
] as const;

// publishSignal is overloaded; ethers requires the full signature to
// disambiguate which one to call.
export const PUBLISH_SIGNAL_WITH_EXPIRY =
  "publishSignal(string,uint8,uint8,uint256,uint256,uint256,uint256,string)" as const;
export const PUBLISH_SIGNAL_DEFAULT_EXPIRY =
  "publishSignal(string,uint8,uint8,uint256,uint256,uint256,string)" as const;
