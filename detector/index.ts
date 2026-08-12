// Self-contained signal generator for Priori: polls MEXC's public futures
// API (free, unmetered), screens candidates with a deterministic checklist,
// asks a conviction provider (Gemini by default) to rate the survivors, and
// publishes/resolves signals against the local publisher service. No
// dependency on any other project. See README.md "Detector" section.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { createMexcClient, type Ticker } from "./mexcClient.js";
import { getMarketCapUsd } from "./coingecko.js";
import { scoreDeterministicChecklist, isStrongUptrend } from "./checklist.js";
import { createConvictionProvider, validateConvictionResponse, type ConvictionSetup } from "./convictionProvider.js";
import { ConvictionRateLimiter } from "./rateLimiter.js";
import { PublisherClient } from "./publisherClient.js";
import { SignalStore } from "./store.js";
import { checkResolutions } from "./resolver.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(HERE, "state");
const CANDLE_INTERVAL = "Min15";
const CANDLE_LOOKBACK = 96;
const CONVICTION_CANDLE_WINDOW = 20;
const INTER_SYMBOL_DELAY_MS = 250;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await fs.mkdir(STATE_DIR, { recursive: true });

  const config = loadConfig();
  const mexc = createMexcClient(config.mexcBaseUrl);
  const convictionProvider = createConvictionProvider(config);
  const rateLimiter = new ConvictionRateLimiter({
    maxPerMinute: config.geminiMaxRequestsPerMinute,
    maxPerDay: config.geminiMaxRequestsPerDay,
    cooldownMinutes: config.geminiSymbolCooldownMinutes,
    stateDir: STATE_DIR,
  });
  const publisher = new PublisherClient(config.publisherUrl);
  const store = new SignalStore(STATE_DIR);

  async function processCandidate(ticker: Ticker, btcStrongUptrend: boolean): Promise<void> {
    const symbol = ticker.symbol;
    const candles = await mexc.getCandles(symbol, CANDLE_INTERVAL, CANDLE_LOOKBACK);
    if (candles.length < 10) return;

    const fundingRate = typeof ticker.fundingRate === "number" ? ticker.fundingRate : undefined;
    const baseAsset = symbol.replace(/_USDT$/, "");
    const marketCap = await getMarketCapUsd(baseAsset);

    const deterministic = scoreDeterministicChecklist({ candles, fundingRate, marketCap, btcStrongUptrend });
    if (deterministic.score < config.deterministicThreshold) return;

    const pump = deterministic.pump;
    if (!pump || !Number.isFinite(pump.peak) || pump.peak <= 0) {
      // Screen passed on other items but there's no usable pump structure
      // to price a stop/target from -- nothing to hand the conviction
      // provider or publish.
      return;
    }

    logger.info("passed deterministic screen", {
      symbol,
      score: `${deterministic.score}/${deterministic.maxScore}`,
    });

    const decision = await rateLimiter.check(symbol);
    if (!decision.allowed) {
      rateLimiter.logSkip(symbol, decision);
      return;
    }

    const setup: ConvictionSetup = {
      symbol,
      currentPrice: pump.current,
      basePrice: pump.baseLow,
      pumpPct: pump.pumpPct,
      peakSinceBase: pump.peak,
      fundingRate,
      marketCapUsd: marketCap,
      candles: candles.slice(-CONVICTION_CANDLE_WINDOW).map((c) => ({
        t: new Date(c.time).toISOString(),
        h: c.high,
        l: c.low,
        c: c.close,
        v: c.vol,
      })),
    };

    let raw;
    try {
      raw = await convictionProvider.getConviction(setup);
    } catch (e) {
      logger.warn("conviction call failed, skipping", { symbol, error: (e as Error).message });
      await rateLimiter.record(symbol);
      return;
    }
    await rateLimiter.record(symbol);

    const result = validateConvictionResponse(raw);
    if (!result) {
      logger.warn("conviction response failed validation, skipping publish", { symbol, raw });
      return;
    }

    logger.info("conviction rated", {
      symbol,
      conviction: result.conviction,
      patternConfirmed: result.patternConfirmed,
      catalystClear: result.catalystClear,
      note: result.convictionNote,
    });

    if (result.conviction < config.convictionThreshold) return;

    if (await store.wasPublishedRecently(baseAsset, config.publishDedupWindowMs)) {
      logger.info("already published within the last 24h, skipping", { symbol, token: baseAsset });
      return;
    }

    // No AI-suggested stop/target (Gemini only returns conviction/pattern/
    // catalyst here) -- derive them deterministically from the pump
    // structure: stop just above the swing high with a buffer, target at a
    // configurable risk:reward multiple below entry.
    const entryPrice = pump.current;
    const stopPrice = pump.peak * (1 + config.stopBufferPct);
    const risk = stopPrice - entryPrice;
    const targetPrice = entryPrice - risk * config.targetRrMultiple;
    if (!(stopPrice > entryPrice) || !(targetPrice > 0 && targetPrice < entryPrice)) {
      logger.warn("computed entry/stop/target failed sanity check, skipping publish", {
        symbol,
        entryPrice,
        stopPrice,
        targetPrice,
      });
      return;
    }

    try {
      const publishResult = await publisher.publishSignal({
        token: baseAsset,
        direction: 1, // this detector only ever surfaces the pump-and-fade short setup
        score: result.conviction,
        entryPrice,
        stopPrice,
        targetPrice,
      });

      let expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
      try {
        const onChain = await publisher.fetchSignal(publishResult.id);
        expiresAt = Number(onChain.expiresAt);
      } catch (e) {
        logger.warn("could not fetch back signal for its exact expiresAt, using a 24h estimate", {
          symbol,
          id: publishResult.id,
          error: (e as Error).message,
        });
      }

      await store.recordPublished({
        id: publishResult.id,
        symbol,
        token: baseAsset,
        direction: 1,
        conviction: result.conviction,
        deterministicScore: `${deterministic.score}/${deterministic.maxScore}`,
        entryPrice,
        stopPrice,
        targetPrice,
        publishedAt: new Date().toISOString(),
        expiresAt,
        resolved: false,
        outcome: null,
        exitPrice: null,
        resolvedAt: null,
        txHash: publishResult.transactionHash,
      });

      logger.info("published to Priori", {
        symbol,
        id: publishResult.id,
        conviction: result.conviction,
        txHash: publishResult.transactionHash,
      });
    } catch (e) {
      logger.error("publish failed, continuing", { symbol, error: (e as Error).message });
    }
  }

  async function runCycle(): Promise<void> {
    logger.info("cycle start");

    let tickers: Ticker[];
    try {
      tickers = await mexc.getAllTickers();
    } catch (e) {
      logger.error("failed to fetch tickers, skipping cycle", { error: (e as Error).message });
      return;
    }

    // Must run every cycle regardless of conviction-provider budget -- it
    // only consumes already-free price data.
    try {
      await checkResolutions(tickers, store, publisher);
    } catch (e) {
      logger.error("resolution check failed, continuing", { error: (e as Error).message });
    }

    let btcStrongUptrend = false;
    try {
      const btcCandles = await mexc.getCandles("BTC_USDT", CANDLE_INTERVAL, 32);
      btcStrongUptrend = isStrongUptrend(btcCandles);
    } catch (e) {
      logger.warn("could not fetch BTC candles, assuming neutral", { error: (e as Error).message });
    }

    const candidates = tickers.filter(
      (t) => typeof t.riseFallRate === "number" && Math.abs(t.riseFallRate) >= config.prefilterRiseRate,
    );
    logger.info("prefilter", { totalPairs: tickers.length, candidates: candidates.length });

    for (const ticker of candidates) {
      try {
        await processCandidate(ticker, btcStrongUptrend);
      } catch (e) {
        logger.error("error processing candidate, continuing", { symbol: ticker.symbol, error: (e as Error).message });
      }
      await sleep(INTER_SYMBOL_DELAY_MS);
    }

    logger.info("cycle complete");
  }

  process.on("SIGINT", () => {
    logger.info("shutting down");
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    logger.info("shutting down");
    process.exit(0);
  });

  logger.info("Priori detector starting", {
    pollIntervalMs: config.pollIntervalMs,
    convictionProvider: config.convictionProvider,
    geminiModel: config.geminiModel,
    convictionThreshold: config.convictionThreshold,
    publisherUrl: config.publisherUrl,
  });

  while (true) {
    try {
      await runCycle();
    } catch (e) {
      // Should be unreachable (runCycle already guards its own stages), but
      // nothing may crash the loop, ever.
      logger.error("unexpected error in cycle, continuing", { error: (e as Error).message });
    }
    await sleep(config.pollIntervalMs);
  }
}

main().catch((e) => {
  logger.error("fatal startup error", { error: (e as Error).message });
  process.exit(1);
});
