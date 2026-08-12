// Client for the local Priori publisher service (../service), which signs
// and submits transactions to the on-chain SignalLedger contract. It binds
// to 127.0.0.1 only -- never point publisherUrl at anything else.

// The publisher's /signal and /resolve endpoints scale decimal price strings
// by 1e8 with ethers.parseUnits, which throws on more than 8 fractional
// digits. Detector-computed prices can carry more precision than that, so
// round defensively before sending.
export function toApiPriceString(value: number | string): string {
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) {
    throw new Error(`Cannot convert price to a decimal string: ${value}`);
  }
  const fixed = num.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "" ? "0" : fixed;
}

export interface PublishResult {
  transactionHash: string;
  id: string;
}

export interface OnChainSignal {
  id: string;
  expiresAt: string;
  [key: string]: unknown;
}

export class PublisherClient {
  constructor(private readonly baseUrl: string) {}

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data as { error?: string };
      throw new Error(`Priori ${path} failed: ${res.status} ${err.error ?? JSON.stringify(data)}`);
    }
    return data as T;
  }

  // direction: 1 = short, 2 = long.
  async publishSignal(params: {
    token: string;
    direction: 1 | 2;
    score: number;
    entryPrice: number;
    stopPrice: number;
    targetPrice: number;
  }): Promise<PublishResult> {
    return this.postJson<PublishResult>("/signal", {
      token: params.token,
      direction: params.direction,
      score: params.score,
      entryPrice: toApiPriceString(params.entryPrice),
      stopPrice: toApiPriceString(params.stopPrice),
      targetPrice: toApiPriceString(params.targetPrice),
    });
  }

  // outcome: 1 = target hit, 2 = stop hit, 3 = expired unresolved.
  async resolveSignal(params: { id: string; outcome: 1 | 2 | 3; exitPrice: number }): Promise<PublishResult> {
    return this.postJson<PublishResult>("/resolve", {
      id: params.id,
      outcome: params.outcome,
      exitPrice: toApiPriceString(params.exitPrice),
    });
  }

  async fetchSignal(id: string): Promise<OnChainSignal> {
    const res = await fetch(`${this.baseUrl}/signal/${id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data as { error?: string };
      throw new Error(`Priori /signal/${id} failed: ${res.status} ${err.error ?? JSON.stringify(data)}`);
    }
    return data as OnChainSignal;
  }
}
