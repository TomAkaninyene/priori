// Deterministic scoring for the pump-and-fade short setup, no judgment
// calls involved:
//   #1 Token pumped 50%+ from base
//   #2 Pump is less than 6 hours old (or dump still actively playing out)
//   #3 Volume declining on recent candles
//   #4 Funding rate not below -0.05%
//   #5 Market cap under $500M
//   #6 BTC not in a strong uptrend
//
// Catalyst and pattern confirmation need real judgment and are delegated to
// a conviction provider (see convictionProvider.ts) instead.

import type { Candle } from "./mexcClient.js";

const FUNDING_RATE_FLOOR = -0.0005; // -0.05% as a decimal fraction
export const MARKET_CAP_CEILING = 500_000_000;
export const PUMP_THRESHOLD = 0.5; // 50%
const ROLLOVER_PULLBACK = 0.95; // price has pulled back 5%+ from peak
export const MAX_PUMP_AGE_HOURS = 6;
const MAX_ROLLOVER_AGE_HOURS = 24; // cap for "dump still playing out" allowance

export interface PumpInfo {
  baseLow: number;
  baseIndex: number;
  current: number;
  pumpPct: number;
  pumpStartTime: number | null;
  peak: number;
}

interface ChecklistItem {
  pass: boolean;
  note: string;
  // Raw metric behind the pass/fail, when there is one worth logging a
  // distribution over (e.g. pumpPct, hours since pump start, volume ratio,
  // market cap). Left undefined for booleans with no underlying scalar.
  value?: number | null;
}

export interface DeterministicChecklist {
  items: Record<string, ChecklistItem>;
  score: number;
  maxScore: number;
  pump: PumpInfo | null;
}

// Finds the base (recent local low) and, if price pumped 50%+ off it, the
// point where that pump crossed the 50% line and the peak since then.
function findPumpFromBase(candles: Candle[]): PumpInfo | null {
  if (!candles.length) return null;

  let baseLow = Infinity;
  let baseIndex = -1;
  candles.forEach((c, i) => {
    if (c.low < baseLow) {
      baseLow = c.low;
      baseIndex = i;
    }
  });

  const current = candles[candles.length - 1].close;
  const pumpPct = (current - baseLow) / baseLow;

  let pumpStartTime: number | null = null;
  let peak = -Infinity;
  if (pumpPct >= PUMP_THRESHOLD) {
    const threshold = baseLow * (1 + PUMP_THRESHOLD);
    for (let i = baseIndex; i < candles.length; i++) {
      if (candles[i].close >= threshold && pumpStartTime === null) {
        pumpStartTime = candles[i].time;
      }
      if (candles[i].high > peak) peak = candles[i].high;
    }
  }

  return { baseLow, baseIndex, current, pumpPct, pumpStartTime, peak };
}

function scoreVolumeDeclining(candles: Candle[]): ChecklistItem {
  const recent = candles.slice(-6);
  if (recent.length < 4) return { pass: false, note: "not enough candle history" };
  const mid = Math.floor(recent.length / 2);
  const earlierAvg = recent.slice(0, mid).reduce((s, c) => s + c.vol, 0) / mid;
  const laterAvg = recent.slice(mid).reduce((s, c) => s + c.vol, 0) / (recent.length - mid);
  const pass = laterAvg < earlierAvg;
  // Ratio of later to earlier volume -- passes when < 1 (declining).
  const ratio = earlierAvg > 0 ? laterAvg / earlierAvg : laterAvg > 0 ? Infinity : 1;
  return {
    pass,
    note: `recent avg vol ${laterAvg.toFixed(0)} vs earlier avg ${earlierAvg.toFixed(0)}`,
    value: ratio,
  };
}

export function scoreDeterministicChecklist({
  candles,
  fundingRate,
  marketCap,
  btcStrongUptrend,
}: {
  candles: Candle[];
  fundingRate?: number;
  marketCap?: number | null;
  btcStrongUptrend: boolean;
}): DeterministicChecklist {
  const items: Record<string, ChecklistItem> = {};

  const pump = findPumpFromBase(candles);
  const now = Date.now();

  items.pumpedFromBase = {
    pass: !!pump && pump.pumpPct >= PUMP_THRESHOLD,
    note: pump ? `${(pump.pumpPct * 100).toFixed(1)}% from base` : "no data",
    value: pump ? pump.pumpPct : null,
  };

  if (pump && pump.pumpStartTime) {
    const hoursSince = (now - pump.pumpStartTime) / (1000 * 60 * 60);
    const rolledOver = pump.current <= pump.peak * ROLLOVER_PULLBACK;
    const pass = hoursSince <= MAX_PUMP_AGE_HOURS || (rolledOver && hoursSince <= MAX_ROLLOVER_AGE_HOURS);
    items.pumpAge = {
      pass,
      note: `~${hoursSince.toFixed(1)}h since pump crossed +50%${rolledOver ? ", rolling over" : ""}`,
      value: hoursSince,
    };
  } else {
    items.pumpAge = { pass: false, note: "no confirmed pump start", value: null };
  }

  items.volumeDeclining = scoreVolumeDeclining(candles);

  if (typeof fundingRate === "number") {
    items.fundingRate = {
      pass: fundingRate >= FUNDING_RATE_FLOOR,
      note: `funding rate ${(fundingRate * 100).toFixed(3)}%`,
    };
  } else {
    items.fundingRate = { pass: true, note: "unverified - funding rate unavailable" };
  }

  if (typeof marketCap === "number") {
    items.marketCap = {
      pass: marketCap < MARKET_CAP_CEILING,
      note: `~$${(marketCap / 1_000_000).toFixed(0)}M market cap`,
      value: marketCap,
    };
  } else {
    items.marketCap = { pass: true, note: "unverified - could not resolve market cap, check manually", value: null };
  }

  items.btcNotStrong = {
    pass: !btcStrongUptrend,
    note: btcStrongUptrend ? "BTC in a strong uptrend right now" : "BTC macro is neutral/down",
    value: btcStrongUptrend ? 1 : 0,
  };

  const score = Object.values(items).filter((i) => i.pass).length;
  const maxScore = Object.keys(items).length;

  return { items, score, maxScore, pump };
}

// Used once per cycle for BTC itself, not per-symbol.
export function isStrongUptrend(candles: Candle[]): boolean {
  if (candles.length < 8) return false;
  const recent = candles.slice(-8);
  const start = recent[0].close;
  const end = recent[recent.length - 1].close;
  const changePct = (end - start) / start;
  const allHigherLows = recent.every((c, i) => i === 0 || c.low >= recent[i - 1].low * 0.995);
  return changePct > 0.03 && allHigherLows;
}
