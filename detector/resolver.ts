// Resolution watcher for signals this detector has published. Runs once
// per cycle against whatever tickers that cycle already fetched, and does
// so unconditionally -- it must keep running even when the conviction
// budget for the day is exhausted, since target/stop checks only use
// already-free price data. The one exception is a signal that appears
// expired: that's confirmed with a live publisher read (see
// fetchExpiresAt) before resolving, since it's a consequential on-chain
// write. Fully automatic, no confirmation step.
import type { Ticker } from "./mexcClient.js";
import type { PublisherClient } from "./publisherClient.js";
import type { SignalStore, StoredSignal } from "./store.js";
import { logger } from "./logger.js";

function outcomeLabel(outcome: 1 | 2 | 3): string {
  if (outcome === 1) return "target hit";
  if (outcome === 2) return "stop hit";
  return "expired unresolved";
}

// The stored expiresAt can be a 24h estimate (see index.ts) if the
// post-publish fetch-back failed, so before actually resolving a signal as
// expired -- a consequential, on-chain write -- confirm against the real
// expiresAt from the signal's own contract. Falls back to the stored value,
// loudly, if the read itself fails (e.g. publisher unreachable).
async function fetchExpiresAt(signal: StoredSignal, publisher: PublisherClient): Promise<number> {
  try {
    const onChain = await publisher.fetchSignal(signal.id, signal.contractAddress);
    return Number(onChain.expiresAt);
  } catch (e) {
    logger.warn("could not fetch on-chain expiresAt, falling back to stored estimate", {
      symbol: signal.symbol,
      id: signal.id,
      contractAddress: signal.contractAddress,
      storedExpiresAt: signal.expiresAt,
      error: (e as Error).message,
    });
    return signal.expiresAt;
  }
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
      // Stored value says expired -- confirm against the chain before
      // committing to that outcome, since the stored value may itself be a
      // 24h estimate rather than the real expiresAt.
      const onChainExpiresAt = await fetchExpiresAt(signal, publisher);
      if (nowSeconds >= onChainExpiresAt) {
        outcome = 3;
      }
    }

    if (outcome === null) continue;

    try {
      const result = await publisher.resolveSignal({
        id: signal.id,
        outcome,
        exitPrice: currentPrice,
        contractAddress: signal.contractAddress,
      });
      await store.markResolved(signal.id, signal.contractAddress, {
        outcome,
        exitPrice: currentPrice,
        resolvedAt: new Date().toISOString(),
      });
      logger.info("signal resolved", {
        symbol: signal.symbol,
        id: signal.id,
        contractAddress: signal.contractAddress,
        outcome: outcomeLabel(outcome),
        txHash: result.transactionHash,
      });
    } catch (e) {
      logger.warn("resolve failed, will retry next cycle", {
        symbol: signal.symbol,
        id: signal.id,
        contractAddress: signal.contractAddress,
        error: (e as Error).message,
      });
    }
  }
}
