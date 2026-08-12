import { config } from "../lib/config";
import { getChainName, getExplorerAddressUrl, getSourcifyUrl } from "../lib/chains";
import { formatUpdatedAt } from "../lib/format";

const explorerUrl = getExplorerAddressUrl(config.chainId, config.contractAddress);
const sourcifyUrl = getSourcifyUrl(config.chainId, config.contractAddress);
const chainName = getChainName(config.chainId);

interface HeaderProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  lastUpdated: Date | null;
}

export function Header({ onRefresh, isRefreshing, lastUpdated }: HeaderProps) {
  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__wordmark">Priori</span>
        <p className="header__tagline">every call on-chain, before the outcome is known</p>
      </div>
      <div className="header__actions">
        <nav className="header__links">
          <a href={explorerUrl} target="_blank" rel="noreferrer">
            Contract on {chainName}
          </a>
          <a href={sourcifyUrl} target="_blank" rel="noreferrer">
            Verified on Sourcify
          </a>
          <a href="https://x.com/priori_hq" target="_blank" rel="noreferrer">
            @priori_hq
          </a>
          <a href="https://github.com/TomAkaninyene/priori" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <div className="header__refresh-group">
          {lastUpdated && <span className="header__updated">Updated {formatUpdatedAt(lastUpdated)}</span>}
          <button type="button" className="refresh" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
    </header>
  );
}
