// Best-effort market cap lookup via CoinGecko's free public API.
//
// Limitation worth knowing: MEXC ticker symbols (e.g. "PEPEUSDT") don't map
// cleanly to CoinGecko coin IDs -- multiple coins can share a ticker symbol.
// This does a simple search-by-symbol and takes the top result, which is
// usually right for well-known tokens but can occasionally mismatch for
// obscure ones. When it can't confidently resolve a market cap, it returns
// `null` rather than guessing -- the checklist treats that as a soft pass
// (doesn't block detection) but flags it as "unverified".

export async function getMarketCapUsd(baseAsset: string): Promise<number | null> {
  try {
    const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(baseAsset)}`);
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as { coins?: Array<{ id?: string }> };
    const coin = searchData?.coins?.[0];
    if (!coin?.id) return null;

    const marketRes = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coin.id}`);
    if (!marketRes.ok) return null;
    const marketData = (await marketRes.json()) as Array<{ market_cap?: number }>;
    const marketCap = marketData?.[0]?.market_cap;
    return typeof marketCap === "number" ? marketCap : null;
  } catch {
    return null; // network hiccup or unexpected shape -- treat as unresolved, not a failure
  }
}
