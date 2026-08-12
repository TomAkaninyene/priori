// Chain-specific display values (explorer host, network name) keyed by
// VITE_CHAIN_ID, so the rest of the app never hardcodes which X Layer
// network it's pointed at -- see lib/config.ts for the single source of
// the raw env values.
interface ChainInfo {
  name: string;
  explorerBaseUrl: string;
}

const CHAINS: Record<number, ChainInfo> = {
  196: { name: "X Layer", explorerBaseUrl: "https://www.okx.com/web3/explorer/xlayer" },
  1952: { name: "X Layer Testnet", explorerBaseUrl: "https://www.okx.com/web3/explorer/xlayer-test" },
};

function getChainInfo(chainId: number): ChainInfo {
  const info = CHAINS[chainId];
  if (!info) {
    throw new Error(`Unknown chain id ${chainId} -- add it to lib/chains.ts`);
  }
  return info;
}

export function getChainName(chainId: number): string {
  return getChainInfo(chainId).name;
}

export function getExplorerAddressUrl(chainId: number, address: string): string {
  return `${getChainInfo(chainId).explorerBaseUrl}/address/${address}`;
}

// Sourcify's repo-ui path takes the raw numeric chain ID directly, so no
// per-chain lookup is needed here beyond what config.chainId already gives.
export function getSourcifyUrl(chainId: number, address: string): string {
  return `https://sourcify.dev/server/repo-ui/${chainId}/${address}`;
}
