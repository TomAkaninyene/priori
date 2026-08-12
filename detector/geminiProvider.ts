// Gemini implementation of ConvictionProvider. Uses responseSchema to force
// strict JSON output shape from the API itself; validateConvictionResponse()
// in convictionProvider.ts still re-checks the result independently before
// anything is trusted, since a schema hint is not a correctness guarantee.
import { logger } from "./logger.js";
import type { ConvictionProvider, ConvictionSetup, RawConvictionResponse } from "./convictionProvider.js";

const SYSTEM_PROMPT = `You are a trading checklist assistant evaluating a potential short setup on a token \
that already pumped and may be rolling over. You are not placing any trades and you have NO access to \
external news or web search -- your only inputs are the price/volume data in the user message. This is \
informational rating only.

Using only the data given:
1. Catalyst check: you cannot check for real news. Set catalyst_clear: true (no confirmed catalyst, looks \
like pure hype) unless the price/volume shape itself suggests something unusual (e.g. sustained volume with \
no reversion at all, more consistent with a real catalyst than a pure hype pump). Never guess at outside \
news you don't have -- base this only on the price/volume shape.
2. Pattern check: using the candle data provided (recent highs/lows/closes, chronological, oldest first), \
assess whether a dead-cat-bounce or a lower-high is already visibly confirmed. Do not assume one is present \
if the data doesn't clearly show it.
3. Conviction rating: an overall conviction score from 0 to 10 for this short setup, plus a one-sentence \
conviction_note explaining it. Weigh: how clean the rollover pattern is, whether volume is actually \
declining, how much of the pump has already faded from the peak, thin-data risk, and that you cannot verify \
a catalyst is truly absent.
4. Price levels: suggest stop_price and target_price for entering this short now, at current_price.
   - stop_price must be greater than current_price. Place it just above the most recent meaningful swing \
high in the candle data given -- real structure, not an arbitrary round number or a fixed percentage.
   - target_price must be less than current_price. Base it on a realistic downside objective the data \
supports, such as a retracement toward base_price, not a formula. Where the structure reasonably allows it, \
aim for at least 1:2 risk:reward from current_price, but never stretch target_price past what the data \
supports just to hit that ratio.
   If the data is too thin to place a defensible stop or target, still return your best-supported numbers \
(they must be present and correctly ordered) but say so in conviction_note and let it pull the score down.

Calibration:
- 0-2: doesn't look like a fade at all, or the data is too thin/contradictory to trust.
- 3-4: marginal -- individually plausible but with a real, specific doubt (ambiguous pattern, thin history, \
still making new highs).
- 5-6: reasonable, unremarkable setup -- no red flags, nothing standout either.
- 7-8: clean rollover, clearly confirmed, no signs of continuation, good separation from the peak.
- 9-10: as strong as this pattern gets from price data alone -- reserve for setups with nothing to quibble \
about.

Be honest and conservative. If the data is too thin to judge confidently, say so in conviction_note and let \
that pull the score down rather than defaulting to the middle.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    conviction: { type: "INTEGER", minimum: 0, maximum: 10 },
    conviction_note: { type: "STRING" },
    pattern_confirmed: { type: "BOOLEAN" },
    catalyst_clear: { type: "BOOLEAN" },
    stop_price: { type: "NUMBER" },
    target_price: { type: "NUMBER" },
  },
  required: ["conviction", "conviction_note", "pattern_confirmed", "catalyst_clear", "stop_price", "target_price"],
} as const;

function buildUserPrompt(setup: ConvictionSetup): string {
  return JSON.stringify({
    symbol: setup.symbol,
    current_price: setup.currentPrice,
    base_price: setup.basePrice,
    pump_pct: setup.pumpPct !== null ? `${(setup.pumpPct * 100).toFixed(1)}%` : null,
    peak_since_base: setup.peakSinceBase,
    funding_rate: setup.fundingRate ?? null,
    market_cap_usd: setup.marketCapUsd ?? null,
    recent_candles_oldest_first: setup.candles,
  });
}

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  maxRetries: number;
}

export function createGeminiProvider(opts: GeminiProviderOptions): ConvictionProvider {
  return {
    name: "gemini",
    async getConviction(setup: ConvictionSetup): Promise<RawConvictionResponse> {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`;
      const body = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [{ text: `Evaluate this setup for ${setup.symbol}:\n\n${buildUserPrompt(setup)}` }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      };

      let attempt = 0;
      while (true) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (res.status === 429) {
          attempt += 1;
          if (attempt > opts.maxRetries) {
            throw new Error(`Gemini rate-limited after ${attempt - 1} retries (429)`);
          }
          const delayMs = Math.min(30_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
          logger.warn("gemini 429, backing off", { symbol: setup.symbol, attempt, delayMs });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`Gemini request failed: ${res.status} ${errText.slice(0, 300)}`);
        }

        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");

        try {
          return JSON.parse(text) as RawConvictionResponse;
        } catch {
          throw new Error(`Could not parse Gemini response as JSON. Raw: ${text.slice(0, 500)}`);
        }
      }
    },
  };
}
