import { config } from "../lib/config";

const explorerUrl = `https://www.oklink.com/xlayer-test/address/${config.contractAddress}`;
const sourcifyUrl = `https://sourcify.dev/server/repo-ui/${config.chainId}/${config.contractAddress}`;

export function Header() {
  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__wordmark">Priori</span>
        <p className="header__tagline">every call on-chain, before the outcome is known</p>
      </div>
      <nav className="header__links">
        <a href={explorerUrl} target="_blank" rel="noreferrer">
          Contract on X Layer
        </a>
        <a href={sourcifyUrl} target="_blank" rel="noreferrer">
          Verified on Sourcify
        </a>
      </nav>
    </header>
  );
}
