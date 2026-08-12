import { Header } from "./components/Header";
import { StatsBar } from "./components/StatsBar";
import { SignalTable } from "./components/SignalTable";
import { HowItWorks } from "./components/HowItWorks";
import { useSignalLedger } from "./hooks/useSignalLedger";
import { config } from "./lib/config";

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
