import { config } from "../lib/config";
import { getChainName, getExplorerAddressUrl, getSourcifyUrl } from "../lib/chains";

const explorerUrl = getExplorerAddressUrl(config.chainId, config.contractAddress);
const sourcifyUrl = getSourcifyUrl(config.chainId, config.contractAddress);
const chainName = getChainName(config.chainId);

export function Header() {
  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__wordmark">Priori</span>
        <p className="header__tagline">every call on-chain, before the outcome is known</p>
      </div>
      <nav className="header__links">
        <a href={explorerUrl} target="_blank" rel="noreferrer">
          Contract on {chainName}
        </a>
        <a href={sourcifyUrl} target="_blank" rel="noreferrer">
          Verified on Sourcify
        </a>
      </nav>
    </header>
  );
}
