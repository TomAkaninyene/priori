// MEXC Futures public market-data client. No API key -- detection stays
// free and unmetered.
//
// IMPORTANT: These endpoint paths and field names are built against MEXC's
// documented futures API structure. MEXC has changed its futures API base
// domain before. If any fetch here starts failing or returning unexpected
// shapes, check https://www.mexc.com/api-docs/futures for the current
// path/field names and update just this file -- nothing else needs to change.

import dns from "node:dns";
import { Agent, setGlobalDispatcher } from "undici";

export interface Ticker {
  symbol: string;
  lastPrice: number;
  riseFallRate?: number;
  fundingRate?: number;
  volume24?: number;
}

export interface Candle {
  time: number; // ms
  open: number;
  close: number;
  high: number;
  low: number;
  vol: number;
}

// Some ISPs run DNS-level filtering that blocks resolution of exchange
// domains like mexc.com even though the site itself is reachable (their
// resolver returns a bogus/NXDOMAIN answer instead of the real IPs). Node's
// fetch() resolves hostnames via the OS resolver (dns.lookup), which ignores
// dns.setServers() -- so the fix has to happen at the HTTP client level
// instead. This routes *.mexc.com lookups through public resolvers while
// leaving every other domain on the normal OS resolver.
const publicResolver = new dns.promises.Resolver();
publicResolver.setServers(["1.1.1.1", "8.8.8.8"]);

function mexcAwareLookup(
  hostname: string,
  options: dns.LookupOptions | ((err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void),
  callback?: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
): void {
  let opts: dns.LookupOptions;
  let cb: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void;
  if (typeof options === "function") {
    cb = options;
    opts = {};
  } else {
    cb = callback as (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void;
    opts = options;
  }
  if (!hostname.endsWith("mexc.com")) {
    dns.lookup(hostname, opts, cb);
    return;
  }
  publicResolver
    .resolve4(hostname)
    .then((addresses) => {
      if (!addresses.length) {
        cb(new Error(`No A records for ${hostname} from public resolver`) as NodeJS.ErrnoException, null);
        return;
      }
      cb(
        null,
        opts?.all ? addresses.map((address) => ({ address, family: 4 })) : addresses[0],
        4,
      );
    })
    .catch((err) => cb(err, null));
}

setGlobalDispatcher(new Agent({ connect: { lookup: mexcAwareLookup as never } }));

export function createMexcClient(baseUrl: string) {
  async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`MEXC request failed: ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    // Returns an array of all futures tickers in one call.
    async getAllTickers(): Promise<Ticker[]> {
      const data = await getJson<{ data: Ticker[] }>("/api/v1/contract/ticker");
      const list = data?.data;
      if (!Array.isArray(list)) {
        throw new Error("Unexpected ticker response shape from MEXC -- check mexcClient.ts against live docs");
      }
      return list;
    },

    // Returns recent candles for one symbol, oldest first.
    async getCandles(symbol: string, interval = "Min15", limit = 96): Promise<Candle[]> {
      const data = await getJson<{
        data?: { time: number[]; open: number[]; close: number[]; high: number[]; low: number[]; vol: number[] };
      }>(`/api/v1/contract/kline/${symbol}?interval=${interval}`);
      const d = data?.data;
      if (!d || !Array.isArray(d.time)) {
        throw new Error(`Unexpected kline response shape for ${symbol} -- check mexcClient.ts against live docs`);
      }
      const candles: Candle[] = d.time.map((t, i) => ({
        time: t * 1000, // MEXC typically returns seconds; normalize to ms
        open: d.open[i],
        close: d.close[i],
        high: d.high[i],
        low: d.low[i],
        vol: d.vol[i],
      }));
      return candles.slice(-limit);
    },
  };
}

export type MexcClient = ReturnType<typeof createMexcClient>;
