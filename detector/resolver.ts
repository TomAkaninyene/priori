// Resolution watcher for signals this detector has published. Runs once
// per cycle against whatever tickers that cycle already fetched (no extra
// API calls), and does so unconditionally -- it must keep running even
// when the conviction budget for the day is exhausted, since it only uses
// already-free price data. Fully automatic, no confirmation step.
import type { Ticker } from "./mexcClient.js";
import type { PublisherClient } from "./publisherClient.js";
import type { SignalStore } from "./store.js";
import { logger } from "./logger.js";

function outcomeLabel(outcome: 1 | 2 | 3): string {
  if (outcome === 1) return "target hit";
  if (outcome === 2) return "stop hit";
  return "expired unresolved";
}

export async function checkResolutions(
  tickers: Ticker[],
  store: SignalStore,
  publisher: PublisherClient,
): Promise<void> {
  const unresolved = await store.getUnresolved();
  if (unresolved.length === 0) return;

  const priceBySymbol = new Map(tickers.map((t) => [t.symbol, t.lastPrice]));
  const nowSeconds = Math.floor(Date.now() / 1000);

  for (const signal of unresolved) {
    const rawPrice = priceBySymbol.get(signal.symbol);
    const currentPrice = Number(rawPrice);
    if (rawPrice === undefined || !Number.isFinite(currentPrice)) continue;

    // direction 1 = short: target is below entry, stop is above entry.
    const targetTouched =
      signal.direction === 1 ? currentPrice <= signal.targetPrice : currentPrice >= signal.targetPrice;
    const stopTouched =
      signal.direction === 1 ? currentPrice >= signal.stopPrice : currentPrice <= signal.stopPrice;

    let outcome: 1 | 2 | 3 | null = null;
    if (targetTouched && stopTouched) {
      // Both levels crossed within one poll interval -- a single price
      // sample can't tell us which happened first, so resolve
      // conservatively as the stop rather than assume the better outcome.
      outcome = 2;
    } else if (targetTouched) {
      outcome = 1;
    } else if (stopTouched) {
      outcome = 2;
    } else if (nowSeconds >= signal.expiresAt) {
      outcome = 3;
    }

    if (outcome === null) continue;

    try {
      const result = await publisher.resolveSignal({ id: signal.id, outcome, exitPrice: currentPrice });
      await store.markResolved(signal.id, { outcome, exitPrice: currentPrice, resolvedAt: new Date().toISOString() });
      logger.info("signal resolved", {
        symbol: signal.symbol,
        id: signal.id,
        outcome: outcomeLabel(outcome),
        txHash: result.transactionHash,
      });
    } catch (e) {
      logger.warn("resolve failed, will retry next cycle", {
        symbol: signal.symbol,
        id: signal.id,
        error: (e as Error).message,
      });
    }
  }
}
