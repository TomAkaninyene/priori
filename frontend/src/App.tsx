import { Header } from "./components/Header";
import { StatsBar } from "./components/StatsBar";
import { SignalTable } from "./components/SignalTable";
import { HowItWorks } from "./components/HowItWorks";
import { useSignalLedger } from "./hooks/useSignalLedger";

function App() {
  const { status, signals, stats, error, refresh } = useSignalLedger();

  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="toolbar">
          <button type="button" className="refresh" onClick={refresh} disabled={status === "loading"}>
            {status === "loading" ? "Refreshing…" : "Refresh"}
          </button>
        </div>

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
