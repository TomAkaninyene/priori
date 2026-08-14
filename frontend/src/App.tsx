import { Header } from "./components/Header";
import { StatsBar } from "./components/StatsBar";
import { SignalTable } from "./components/SignalTable";
import { HowItWorks } from "./components/HowItWorks";
import { useSignalLedger } from "./hooks/useSignalLedger";
import { config } from "./lib/config";
import { V1_CONTRACT_ADDRESS } from "./lib/contract";
import { getExplorerAddressUrl } from "./lib/chains";

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
            <StatsBar stats={stats} signals={signals} />
            <p className="filter-note">
              Shown here: signals that cleared conviction ≥ {config.convictionThreshold}/10 and risk:reward ≥{" "}
              {config.minRiskReward}:1 to publish.
            </p>
            <p className="filter-note">
              The table below merges history from both deployments, newest first, labeled v1/v2 per row. v2,
              deployed August 12, 2026, emits the AI's reasoning on-chain in each signal's note; v1 predates the
              note field, so its rows show "—" there. The v1 contract is still live and verified at{" "}
              <a href={getExplorerAddressUrl(config.chainId, V1_CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
                {V1_CONTRACT_ADDRESS}
              </a>
              , and its still-open signals are resolved by the same resolver.
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
