// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SignalLedger
/// @notice A permanent, append-only record of trading signals. Once
/// published, a signal's data can never be edited or deleted by anyone,
/// including the owner. A signal can be resolved exactly once, and that
/// resolution is final. There is no pause, upgrade, delete, edit, or
/// ownership-transfer function, and no selfdestruct.
contract SignalLedger {
  struct Signal {
    uint256 id;
    string token;
    uint8 direction; // 1 = short, 2 = long
    uint8 score; // 0-10
    uint256 entryPrice; // scaled by 1e8
    uint256 stopPrice; // scaled by 1e8
    uint256 targetPrice; // scaled by 1e8
    uint256 publishedAt;
    uint256 expiresAt;
    bool resolved;
    uint8 outcome; // 1 = target hit, 2 = stop hit, 3 = expired unresolved
    uint256 exitPrice; // scaled by 1e8
    uint256 resolvedAt;
  }

  uint256 public constant DEFAULT_EXPIRY_WINDOW = 24 hours;

  address public immutable owner;

  uint256 public signalCount;

  mapping(uint256 => Signal) private signals;

  event SignalPublished(
    uint256 indexed id,
    string token,
    uint8 direction,
    uint8 score,
    uint256 entryPrice,
    uint256 stopPrice,
    uint256 targetPrice,
    uint256 publishedAt,
    uint256 expiresAt
  );

  event SignalResolved(
    uint256 indexed id,
    uint8 outcome,
    uint256 exitPrice,
    uint256 resolvedAt
  );

  modifier onlyOwner() {
    require(msg.sender == owner, "SignalLedger: caller is not the owner");
    _;
  }

  constructor() {
    owner = msg.sender;
  }

  function publishSignal(
    string calldata token,
    uint8 direction,
    uint8 score,
    uint256 entryPrice,
    uint256 stopPrice,
    uint256 targetPrice,
    uint256 expiresAt
  ) external onlyOwner returns (uint256 id) {
    id = _publish(token, direction, score, entryPrice, stopPrice, targetPrice, expiresAt);
  }

  function publishSignal(
    string calldata token,
    uint8 direction,
    uint8 score,
    uint256 entryPrice,
    uint256 stopPrice,
    uint256 targetPrice
  ) external onlyOwner returns (uint256 id) {
    id = _publish(
      token,
      direction,
      score,
      entryPrice,
      stopPrice,
      targetPrice,
      block.timestamp + DEFAULT_EXPIRY_WINDOW
    );
  }

  function resolveSignal(uint256 id, uint8 outcome, uint256 exitPrice) external onlyOwner {
    require(id > 0 && id <= signalCount, "SignalLedger: signal does not exist");
    Signal storage signal = signals[id];
    require(!signal.resolved, "SignalLedger: already resolved");
    require(
      outcome == 1 || outcome == 2 || outcome == 3,
      "SignalLedger: invalid outcome"
    );

    // Cross-check the claimed outcome against the signal's own stop/target
    // levels using the reported exitPrice. This prevents an outcome being
    // recorded that contradicts its own reported exit price (e.g. claiming
    // "target hit" with an exit price that never reached the target).
    // Outcome 3 (expired unresolved) has no price constraint.
    if (outcome == 1) {
      if (signal.direction == 1) {
        require(
          exitPrice <= signal.targetPrice,
          "SignalLedger: exitPrice does not confirm target hit"
        );
      } else {
        require(
          exitPrice >= signal.targetPrice,
          "SignalLedger: exitPrice does not confirm target hit"
        );
      }
    } else if (outcome == 2) {
      if (signal.direction == 1) {
        require(
          exitPrice >= signal.stopPrice,
          "SignalLedger: exitPrice does not confirm stop hit"
        );
      } else {
        require(
          exitPrice <= signal.stopPrice,
          "SignalLedger: exitPrice does not confirm stop hit"
        );
      }
    }

    signal.resolved = true;
    signal.outcome = outcome;
    signal.exitPrice = exitPrice;
    signal.resolvedAt = block.timestamp;

    emit SignalResolved(id, outcome, exitPrice, signal.resolvedAt);
  }

  function getSignal(uint256 id) external view returns (Signal memory) {
    require(id > 0 && id <= signalCount, "SignalLedger: signal does not exist");
    return signals[id];
  }

  function getSignalCount() external view returns (uint256) {
    return signalCount;
  }

  /// @notice Tallies the ledger's effective track record.
  /// @dev A signal left unresolved past its expiresAt (unresolvedExpired) is
  /// folded into `losses`: a stale signal that nobody ever resolved cannot
  /// be allowed to improve the record simply by avoiding resolution, so
  /// silence is scored the same as a stop-out. `unresolvedExpired` is still
  /// exposed separately so callers can see how many signals are stalled.
  function getStats()
    external
    view
    returns (
      uint256 totalPublished,
      uint256 totalResolved,
      uint256 wins,
      uint256 losses,
      uint256 unresolvedExpired
    )
  {
    totalPublished = signalCount;

    for (uint256 i = 1; i <= signalCount; i++) {
      Signal storage signal = signals[i];
      if (signal.resolved) {
        totalResolved++;
        if (signal.outcome == 1) {
          wins++;
        } else {
          losses++;
        }
      } else if (signal.expiresAt < block.timestamp) {
        unresolvedExpired++;
      }
    }

    losses += unresolvedExpired;
  }

  function _publish(
    string calldata token,
    uint8 direction,
    uint8 score,
    uint256 entryPrice,
    uint256 stopPrice,
    uint256 targetPrice,
    uint256 expiresAt
  ) private returns (uint256 id) {
    require(expiresAt > block.timestamp, "SignalLedger: expiresAt not in future");
    require(direction == 1 || direction == 2, "SignalLedger: invalid direction");
    require(score <= 10, "SignalLedger: score above 10");

    if (direction == 1) {
      require(stopPrice > entryPrice, "SignalLedger: short stopPrice must be above entryPrice");
      require(targetPrice < entryPrice, "SignalLedger: short targetPrice must be below entryPrice");
    } else {
      require(stopPrice < entryPrice, "SignalLedger: long stopPrice must be below entryPrice");
      require(targetPrice > entryPrice, "SignalLedger: long targetPrice must be above entryPrice");
    }

    id = ++signalCount;
    uint256 publishedAt = block.timestamp;

    signals[id] = Signal({
      id: id,
      token: token,
      direction: direction,
      score: score,
      entryPrice: entryPrice,
      stopPrice: stopPrice,
      targetPrice: targetPrice,
      publishedAt: publishedAt,
      expiresAt: expiresAt,
      resolved: false,
      outcome: 0,
      exitPrice: 0,
      resolvedAt: 0
    });

    emit SignalPublished(
      id,
      token,
      direction,
      score,
      entryPrice,
      stopPrice,
      targetPrice,
      publishedAt,
      expiresAt
    );
  }
}
