// Conviction sits behind this interface so a different model (Claude,
// another Gemini model, a local model, ...) can be swapped in via the
// CONVICTION_PROVIDER env var without touching detection.ts or publisher.ts.
// The provider's only job is to return whatever it parsed out of the model
// response -- validateConvictionResponse() below is the single place that
// decides whether a response is trustworthy enough to publish on, and it
// runs identically no matter which provider produced the raw response.

import type { DetectorConfig } from "./config.js";
import { createGeminiProvider } from "./geminiProvider.js";

export interface CandleSummary {
  t: string; // ISO timestamp
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface ConvictionSetup {
  symbol: string;
  currentPrice: number;
  basePrice: number;
  pumpPct: number | null;
  peakSinceBase: number | null;
  fundingRate?: number;
  marketCapUsd?: number | null;
  candles: CandleSummary[]; // ~20 recent candles, oldest first
}

// Untrusted shape as returned by a provider, before validation.
export type RawConvictionResponse = unknown;

export interface ConvictionResult {
  conviction: number; // validated integer 0-10
  convictionNote: string;
  patternConfirmed: boolean;
  catalystClear: boolean;
}

export interface ConvictionProvider {
  readonly name: string;
  getConviction(setup: ConvictionSetup): Promise<RawConvictionResponse>;
}

// Fail closed: anything that doesn't match this exact shape returns null,
// and the caller must skip the publish rather than guess at a default.
export function validateConvictionResponse(raw: RawConvictionResponse): ConvictionResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const conviction = r.conviction;
  if (typeof conviction !== "number" || !Number.isInteger(conviction) || conviction < 0 || conviction > 10) {
    return null;
  }
  if (typeof r.conviction_note !== "string") return null;
  if (typeof r.pattern_confirmed !== "boolean") return null;
  if (typeof r.catalyst_clear !== "boolean") return null;

  return {
    conviction,
    convictionNote: r.conviction_note,
    patternConfirmed: r.pattern_confirmed,
    catalystClear: r.catalyst_clear,
  };
}

export function createConvictionProvider(config: DetectorConfig): ConvictionProvider {
  switch (config.convictionProvider) {
    case "gemini":
      return createGeminiProvider({
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
        maxRetries: config.geminiMaxRetries,
      });
    default:
      throw new Error(
        `Unknown CONVICTION_PROVIDER "${config.convictionProvider}". ` +
          `To add one, implement ConvictionProvider in a new file and wire it up in createConvictionProvider() -- ` +
          `detection and publishing don't need to change.`,
      );
  }
}
