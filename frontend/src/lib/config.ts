export interface AppConfig {
  rpcUrl: string;
  contractAddress: string;
  chainId: number;
  // Informational only -- the detector's own DETECTOR_CONVICTION_THRESHOLD /
  // DETECTOR_MIN_RR (see root .env), mirrored here so the dashboard can tell
  // a reader what filter produced this record. Not read from the detector
  // at runtime (this frontend has no backend), so keep VITE_CONVICTION_THRESHOLD
  // / VITE_MIN_RR (and the fallback defaults below, used when those env vars
  // are unset) in sync by hand with the detector's *actual configured*
  // values -- not just its code defaults -- whenever they change. A stale
  // default here would misstate how the record was actually produced.
  convictionThreshold: number;
  minRiskReward: number;
}

function readEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readOptionalNumber(name: keyof ImportMetaEnv, fallback: number): number {
  const value = import.meta.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadConfig(): AppConfig {
  const rpcUrl = readEnv("VITE_RPC_URL");
  const contractAddress = readEnv("VITE_CONTRACT_ADDRESS");
  const chainId = Number(readEnv("VITE_CHAIN_ID"));

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid VITE_CHAIN_ID: ${import.meta.env.VITE_CHAIN_ID}`);
  }

  // These fallbacks must stay in sync with the detector's currently
  // configured DETECTOR_CONVICTION_THRESHOLD / DETECTOR_MIN_RR (root .env) --
  // as of this writing the detector runs with threshold 6 (overriding its
  // own code default of 7) and the default min R:R of 1.5.
  const convictionThreshold = readOptionalNumber("VITE_CONVICTION_THRESHOLD", 6);
  const minRiskReward = readOptionalNumber("VITE_MIN_RR", 1.5);

  return { rpcUrl, contractAddress, chainId, convictionThreshold, minRiskReward };
}

export const config = loadConfig();
