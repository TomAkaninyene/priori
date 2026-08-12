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
import {
  scoreDeterministicChecklist,
  isStrongUptrend,
  PUMP_THRESHOLD,
  MAX_PUMP_AGE_HOURS,
  MARKET_CAP_CEILING,
  type DeterministicChecklist,
} from "./checklist.js";
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
// Mirrors SignalLedger.MAX_NOTE_LENGTH -- the contract counts UTF-8 bytes,
// not JS string length, so truncation is checked both ways rather than
// failing the publish over a rare multi-byte edge case.
const MAX_NOTE_LENGTH = 500;

function truncateNote(note: string): string {
  let truncated = note.length > MAX_NOTE_LENGTH ? note.slice(0, MAX_NOTE_LENGTH) : note;
  while (Buffer.byteLength(truncated, "utf8") > MAX_NOTE_LENGTH) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Per-cycle observability into where the deterministic checklist rejects
// candidates -- kept separate from the checklist's own pass/fail scoring
// (checklist.ts) so this is pure logging with no effect on which signals
// publish. Only covers candidates that already cleared the cheap
// ticker-level pump% prefilter below (see the "prefilter: pump %" log) --
// running the full checklist (candle history + a CoinGecko market cap
// lookup per symbol) against all ~1,100 pairs every cycle would multiply
// MEXC/CoinGecko call volume by ~10-50x and blow past CoinGecko's free-tier
// rate limit.
const CHECKLIST_CRITERIA = [
  "pumpedFromBase",
  "pumpAge",
  "volumeDeclining",
  "fundingRate",
  "marketCap",
  "btcNotStrong",
] as const;
type ChecklistCriterion = (typeof CHECKLIST_CRITERIA)[number];

// How far past the threshold a failing value is, normalized so 0 = right at
// the line and larger = further from passing. Only defined for criteria
// with a numeric value on both sides of the line; btcNotStrong is a single
// cycle-wide boolean (not per-symbol), so it has no meaningful distance.
const CRITERION_DISTANCE: Partial<Record<ChecklistCriterion, (value: number) => number>> = {
  pumpedFromBase: (v) => PUMP_THRESHOLD - v,
  pumpAge: (v) => v - MAX_PUMP_AGE_HOURS,
  volumeDeclining: (v) => v - 1, // ratio of later/earlier volume; passes when < 1
  marketCap: (v) => v / MARKET_CAP_CEILING - 1,
};

interface CriterionMiss {
  symbol: string;
  note: string;
  distance: number | null;
}

interface CriterionAccumulator {
  evaluated: number;
  rejected: number;
  misses: CriterionMiss[];
}

type ChecklistStats = Record<ChecklistCriterion, CriterionAccumulator>;

function newChecklistStats(): ChecklistStats {
  const stats = {} as ChecklistStats;
  for (const key of CHECKLIST_CRITERIA) {
    stats[key] = { evaluated: 0, rejected: 0, misses: [] };
  }
  return stats;
}

function recordChecklist(stats: ChecklistStats, symbol: string, items: DeterministicChecklist["items"]): void {
  for (const key of CHECKLIST_CRITERIA) {
    const item = items[key];
    if (!item) continue;
    const acc = stats[key];
    acc.evaluated++;
    if (item.pass) continue;
    const distanceFn = CRITERION_DISTANCE[key];
    const distance = distanceFn && typeof item.value === "number" ? distanceFn(item.value) : null;
    acc.rejected++;
    acc.misses.push({ symbol, note: item.note, distance });
  }
}

function logChecklistBreakdown(stats: ChecklistStats): void {
  const summary = CHECKLIST_CRITERIA.map((key) => {
    const acc = stats[key];
    const nearestMisses = [...acc.misses]
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
      .slice(0, 5)
      .map((m) => ({ symbol: m.symbol, note: m.note }));
    return {
      criterion: key,
      evaluated: acc.evaluated,
      rejected: acc.rejected,
      rejectRate: acc.evaluated ? `${((acc.rejected / acc.evaluated) * 100).toFixed(1)}%` : "n/a",
      nearestMisses,
    };
  }).sort((a, b) => b.rejected - a.rejected);

  logger.info("deterministic checklist breakdown (candidates past the pump% prefilter only)", {
    candidatesEvaluated: summary[0]?.evaluated ?? 0,
    topRejector: summary.find((s) => s.rejected > 0)?.criterion ?? "none",
    criteria: summary,
  });
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

  // New signals are only ever published to the publisher's primary
  // contract -- fetched once at startup (rather than hardcoded here) so
  // this never drifts from whatever CONTRACT_ADDRESS the service is
  // actually configured with. Stored alongside each signal so the resolver
  // knows which contract to target later, the same as it does for
  // legacy-contract signals (see resolver.ts).
  const primaryContractAddress = (await publisher.getHealth()).contractAddress;
  logger.info("resolved primary contract from publisher", { contractAddress: primaryContractAddress });

  async function processCandidate(ticker: Ticker, btcStrongUptrend: boolean, checklistStats: ChecklistStats): Promise<void> {
    const symbol = ticker.symbol;
    const candles = await mexc.getCandles(symbol, CANDLE_INTERVAL, CANDLE_LOOKBACK);
    if (candles.length < 10) return;

    const fundingRate = typeof ticker.fundingRate === "number" ? ticker.fundingRate : undefined;
    const baseAsset = symbol.replace(/_USDT$/, "");
    const marketCap = await getMarketCapUsd(baseAsset);

    const deterministic = scoreDeterministicChecklist({ candles, fundingRate, marketCap, btcStrongUptrend });
    recordChecklist(checklistStats, symbol, deterministic.items);
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

    const entryPrice = pump.current;

    let raw;
    try {
      raw = await convictionProvider.getConviction(setup);
    } catch (e) {
      logger.warn("conviction call failed, skipping", { symbol, error: (e as Error).message });
      await rateLimiter.record(symbol);
      return;
    }
    await rateLimiter.record(symbol);

    const result = validateConvictionResponse(raw, entryPrice);
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
      stopPrice: result.stopPrice,
      targetPrice: result.targetPrice,
    });

    if (result.conviction < config.convictionThreshold) return;

    if (await store.wasPublishedRecently(baseAsset, config.publishDedupWindowMs)) {
      logger.info("already published within the last 24h, skipping", { symbol, token: baseAsset });
      return;
    }

    // Prefer the provider's own stop/target -- it can see the actual
    // structure (swing highs, base/support) that a fixed formula can't.
    // Only fall back to the deterministic R:R formula when explicitly
    // enabled; otherwise a missing/invalid/directionally-wrong provider
    // level fails closed, same as an invalid conviction score.
    let stopPrice: number;
    let targetPrice: number;
    if (result.stopPrice !== null && result.targetPrice !== null) {
      stopPrice = result.stopPrice;
      targetPrice = result.targetPrice;
    } else if (config.fallbackToFormulaLevels) {
      stopPrice = pump.peak * (1 + config.stopBufferPct);
      const risk = stopPrice - entryPrice;
      targetPrice = entryPrice - risk * config.targetRrMultiple;
      logger.info("provider stop/target invalid or missing, using formula fallback", {
        symbol,
        providerStopPrice: result.stopPrice,
        providerTargetPrice: result.targetPrice,
        stopPrice,
        targetPrice,
      });
    } else {
      logger.warn("provider did not return valid directional stop/target and formula fallback is disabled, skipping publish", {
        symbol,
        providerStopPrice: result.stopPrice,
        providerTargetPrice: result.targetPrice,
      });
      return;
    }

    if (!(stopPrice > entryPrice) || !(targetPrice > 0 && targetPrice < entryPrice)) {
      logger.warn("entry/stop/target failed sanity check, skipping publish", {
        symbol,
        entryPrice,
        stopPrice,
        targetPrice,
      });
      return;
    }

    // Risk:reward filter, applied to whichever levels are actually about to
    // be published (Gemini's or the formula fallback's) -- logged
    // unconditionally so the R:R distribution across all candidates is
    // visible, not just the ones that end up publishing.
    const risk = stopPrice - entryPrice;
    const reward = entryPrice - targetPrice;
    const riskReward = reward / risk;
    logger.info("computed risk:reward", {
      symbol,
      riskReward: Number(riskReward.toFixed(2)),
      entryPrice,
      stopPrice,
      targetPrice,
    });

    if (riskReward < config.minRiskReward) {
      logger.info("risk:reward below minimum, skipping publish", {
        symbol,
        riskReward: Number(riskReward.toFixed(2)),
        minRiskReward: config.minRiskReward,
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
        note: truncateNote(result.convictionNote),
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
        contractAddress: primaryContractAddress,
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

    // Stage 1: cheap ticker-level prefilter over every pair MEXC returns --
    // no candle fetch or market cap lookup needed, so this is the only
    // criterion checked against the full universe rather than just the
    // survivors.
    let missingRiseFallRate = 0;
    const rejectedByPumpRate: Array<{ symbol: string; riseFallRate: number; distance: number }> = [];
    for (const t of tickers) {
      if (typeof t.riseFallRate !== "number") {
        missingRiseFallRate++;
        continue;
      }
      const abs = Math.abs(t.riseFallRate);
      if (abs < config.prefilterRiseRate) {
        rejectedByPumpRate.push({ symbol: t.symbol, riseFallRate: t.riseFallRate, distance: config.prefilterRiseRate - abs });
      }
    }
    rejectedByPumpRate.sort((a, b) => a.distance - b.distance);

    const candidates = tickers.filter(
      (t) => typeof t.riseFallRate === "number" && Math.abs(t.riseFallRate) >= config.prefilterRiseRate,
    );

    logger.info("prefilter: pump % (ticker-level, all pairs)", {
      totalPairs: tickers.length,
      passed: candidates.length,
      rejected: rejectedByPumpRate.length,
      missingRiseFallRate,
      thresholdPct: `${(config.prefilterRiseRate * 100).toFixed(1)}%`,
      nearestMisses: rejectedByPumpRate.slice(0, 10).map((r) => ({
        symbol: r.symbol,
        riseFallRatePct: `${(r.riseFallRate * 100).toFixed(2)}%`,
      })),
    });

    // Stage 2: the full deterministic checklist (candle-based pump age,
    // volume trend, market cap, BTC trend) only ever runs against pairs
    // that already passed stage 1 -- see the comment above CHECKLIST_CRITERIA.
    const checklistStats = newChecklistStats();

    for (const ticker of candidates) {
      try {
        await processCandidate(ticker, btcStrongUptrend, checklistStats);
      } catch (e) {
        logger.error("error processing candidate, continuing", { symbol: ticker.symbol, error: (e as Error).message });
      }
      await sleep(INTER_SYMBOL_DELAY_MS);
    }

    logChecklistBreakdown(checklistStats);

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
