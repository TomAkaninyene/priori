import "dotenv/config";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return parsed;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? fallback : raw;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() === "true";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface DetectorConfig {
  // MEXC polling
  mexcBaseUrl: string;
  pollIntervalMs: number;
  prefilterRiseRate: number;
  deterministicThreshold: number;

  // Conviction provider
  convictionProvider: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiMaxRequestsPerMinute: number;
  geminiMaxRequestsPerDay: number;
  geminiSymbolCooldownMinutes: number;
  geminiMaxRetries: number;

  // Publishing
  convictionThreshold: number;
  // Formula-derived stop/target, used only as a fallback -- see
  // fallbackToFormulaLevels. Primary source is the conviction provider's
  // own stop_price/target_price.
  stopBufferPct: number;
  targetRrMultiple: number;
  fallbackToFormulaLevels: boolean;
  // Minimum reward:risk (target distance / stop distance) the final entry/
  // stop/target must clear to publish, regardless of where the levels came
  // from. Applied after the conviction threshold check.
  minRiskReward: number;
  publisherUrl: string;
  publishDedupWindowMs: number;
}

export function loadConfig(): DetectorConfig {
  const convictionProvider = str("CONVICTION_PROVIDER", "gemini");

  return {
    mexcBaseUrl: str("MEXC_FUTURES_BASE_URL", "https://api.mexc.com"),
    pollIntervalMs: num("DETECTOR_POLL_INTERVAL_MS", 60_000),
    prefilterRiseRate: num("DETECTOR_PREFILTER_RISE_RATE", 0.2),
    deterministicThreshold: num("DETECTOR_DETERMINISTIC_THRESHOLD", 5),

    convictionProvider,
    // Only the "gemini" provider is implemented today, so its key is only
    // required when it's the one actually selected -- see convictionProvider.ts.
    geminiApiKey: convictionProvider === "gemini" ? requireEnv("GEMINI_API_KEY") : str("GEMINI_API_KEY", ""),
    geminiModel: str("GEMINI_MODEL", "gemini-flash-lite-latest"),
    geminiMaxRequestsPerMinute: num("GEMINI_MAX_REQUESTS_PER_MINUTE", 10),
    geminiMaxRequestsPerDay: num("GEMINI_MAX_REQUESTS_PER_DAY", 200),
    geminiSymbolCooldownMinutes: num("GEMINI_SYMBOL_COOLDOWN_MINUTES", 240),
    geminiMaxRetries: num("GEMINI_MAX_RETRIES", 3),

    convictionThreshold: num("DETECTOR_CONVICTION_THRESHOLD", 7),
    stopBufferPct: num("DETECTOR_STOP_BUFFER_PCT", 0.02),
    targetRrMultiple: num("DETECTOR_TARGET_RR_MULTIPLE", 2),
    fallbackToFormulaLevels: bool("DETECTOR_FALLBACK_TO_FORMULA_LEVELS", false),
    minRiskReward: num("DETECTOR_MIN_RR", 1.5),
    publisherUrl: str("PRIORI_PUBLISHER_URL", "http://127.0.0.1:3001"),
    publishDedupWindowMs: 24 * 60 * 60 * 1000,
  };
}
