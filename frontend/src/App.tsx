import { Header } from "./components/Header";
import { StatsBar } from "./components/StatsBar";
import { SignalTable } from "./components/SignalTable";
import { HowItWorks } from "./components/HowItWorks";
import { useSignalLedger } from "./hooks/useSignalLedger";
import { config } from "./lib/config";
import { getExplorerAddressUrl } from "./lib/chains";

// The prior deployment, superseded by the current contract (config.contractAddress)
// on 2026-08-12. It holds the first four signals and stays live and verified --
// its still-open signals are resolved by the same resolver. See CLAUDE.md
// "Deployed contracts".
const V1_CONTRACT_ADDRESS = "0x5380fadFeF5EaEBCE964Da4248d9327b84726Ed3";

function App() {
  const { status, signals, stats, error, refresh, lastUpdated } = useSignalLedger();

  return (
    <div className="app">
      <Header onRefresh={refresh} isRefreshing={status === "loading"} lastUpdated={lastUpdated} />
      <main className="main">
        {status === "loading" && <p className="state state--loading">Loading signals from chain…</p>}

        {status === "error" && (
          <div className="state state--error">
            <p>Couldn't reach the chain: {error}</p>
            <button type="button" onClick={refresh}>
              Try again
            </button>
          </div>
        )}

        {status === "ready" && stats && (
          <>
            <StatsBar stats={stats} />
            <p className="filter-note">
              Shown here: signals that cleared conviction ≥ {config.convictionThreshold}/10 and risk:reward ≥{" "}
              {config.minRiskReward}:1 to publish.
            </p>
            <p className="filter-note">
              This is contract v2, deployed August 12, 2026, which emits the AI's reasoning on-chain in each
              signal's note. The prior v1 contract, holding the first four signals, is still live and verified at{" "}
              <a href={getExplorerAddressUrl(config.chainId, V1_CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
                {V1_CONTRACT_ADDRESS}
              </a>
              . Its still-open signals are resolved by the same resolver.
            </p>
            {signals.length === 0 ? (
              <p className="state state--empty">No signals published yet.</p>
            ) : (
              <SignalTable signals={signals} />
            )}
          </>
        )}

        <HowItWorks />
      </main>
    </div>
  );
}

export default App;
