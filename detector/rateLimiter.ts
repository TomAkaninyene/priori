// Client-side rate control for conviction-provider calls (Gemini's free
// tier is capped per minute and per day). All three checks are enforced
// *before* a call is made -- when a cap is hit, the caller logs it and
// moves on to the next symbol; nothing is queued or retried within the
// same cycle. Daily count and per-symbol cooldowns are persisted to disk so
// they survive a process restart; the per-minute window is in-memory only,
// since it naturally resets within a minute anyway.
import { promises as fs } from "node:fs";
import path from "node:path";
import { withFileLock } from "./fileLock.js";
import { logger } from "./logger.js";

interface DailyCapState {
  date: string;
  count: number;
}

type CooldownState = Record<string, number>; // symbol -> last-called-at (ms epoch)

export interface RateLimiterOptions {
  maxPerMinute: number;
  maxPerDay: number;
  cooldownMinutes: number;
  stateDir: string;
}

export interface RateLimitDecision {
  allowed: boolean;
  reason?: string;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export class ConvictionRateLimiter {
  private readonly opts: RateLimiterOptions;
  private readonly dailyCapFile: string;
  private readonly cooldownFile: string;
  private minuteWindow: number[] = [];

  constructor(opts: RateLimiterOptions) {
    this.opts = opts;
    this.dailyCapFile = path.join(opts.stateDir, "gemini-daily-cap.json");
    this.cooldownFile = path.join(opts.stateDir, "gemini-cooldowns.json");
  }

  private async readDailyCap(): Promise<DailyCapState> {
    try {
      const state = JSON.parse(await fs.readFile(this.dailyCapFile, "utf8")) as DailyCapState;
      if (state.date !== todayKey()) return { date: todayKey(), count: 0 };
      return state;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { date: todayKey(), count: 0 };
      throw e;
    }
  }

  private async readCooldowns(): Promise<CooldownState> {
    try {
      return JSON.parse(await fs.readFile(this.cooldownFile, "utf8")) as CooldownState;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw e;
    }
  }

  private pruneMinuteWindow(): void {
    const cutoff = Date.now() - 60_000;
    this.minuteWindow = this.minuteWindow.filter((t) => t > cutoff);
  }

  async check(symbol: string): Promise<RateLimitDecision> {
    this.pruneMinuteWindow();
    if (this.minuteWindow.length >= this.opts.maxPerMinute) {
      return { allowed: false, reason: `per-minute cap reached (${this.opts.maxPerMinute}/min)` };
    }

    const daily = await this.readDailyCap();
    if (daily.count >= this.opts.maxPerDay) {
      return { allowed: false, reason: `per-day cap reached (${this.opts.maxPerDay}/day)` };
    }

    const cooldowns = await this.readCooldowns();
    const lastCalledAt = cooldowns[symbol];
    if (lastCalledAt !== undefined) {
      const cooldownMs = this.opts.cooldownMinutes * 60_000;
      const remainingMs = lastCalledAt + cooldownMs - Date.now();
      if (remainingMs > 0) {
        return { allowed: false, reason: `symbol on cooldown for another ${Math.ceil(remainingMs / 60_000)}m` };
      }
    }

    return { allowed: true };
  }

  // Call once per attempted conviction call (success or failure) -- an
  // attempt still counts against the caps and resets the symbol's cooldown,
  // so a persistently-failing symbol can't be hammered every cycle either.
  async record(symbol: string): Promise<void> {
    this.minuteWindow.push(Date.now());

    await withFileLock(`${this.dailyCapFile}.lock`, async () => {
      const state = await this.readDailyCap();
      state.count += 1;
      await fs.writeFile(this.dailyCapFile, JSON.stringify(state), "utf8");
    });

    await withFileLock(`${this.cooldownFile}.lock`, async () => {
      const cooldowns = await this.readCooldowns();
      cooldowns[symbol] = Date.now();
      await fs.writeFile(this.cooldownFile, JSON.stringify(cooldowns), "utf8");
    });
  }

  logSkip(symbol: string, decision: RateLimitDecision): void {
    logger.info("conviction call skipped by rate limiter", { symbol, reason: decision.reason });
  }
}
