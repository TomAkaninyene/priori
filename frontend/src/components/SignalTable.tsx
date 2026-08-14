import type { Signal } from "../lib/types";
import { directionLabel, formatPrice, formatTimestamp, outcomeLabel, signalStatus } from "../lib/format";

interface SignalTableProps {
  signals: Signal[];
}

function outcomeClassName(outcome: number): string {
  return outcome === 1 ? "outcome" : "outcome outcome--loss";
}

export function SignalTable({ signals }: SignalTableProps) {
  const nowSeconds = Math.floor(Date.now() / 1000);

  return (
    <>
      <p className="table-scroll-hint">Scroll to see all columns →</p>
      <div className="table-wrap">
        <table className="signal-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Version</th>
              <th>Token</th>
              <th>Direction</th>
              <th>Score</th>
              <th>Entry</th>
              <th>Stop</th>
              <th>Target</th>
              <th>Published</th>
              <th>Status</th>
              <th>Outcome</th>
              <th>Exit</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((signal) => {
              const status = signalStatus(signal, nowSeconds);
              return (
                <tr key={`${signal.version}-${signal.id}`}>
                  <td data-label="ID">{signal.id.toString()}</td>
                  <td data-label="Version">
                    <span className={`badge badge--${signal.version}`}>{signal.version}</span>
                  </td>
                  <td data-label="Token">{signal.token}</td>
                  <td data-label="Direction">{directionLabel(signal.direction)}</td>
                  <td data-label="Score" className="signal-table__score">
                    {signal.score}/10
                  </td>
                  <td data-label="Entry">{formatPrice(signal.entryPrice)}</td>
                  <td data-label="Stop">{formatPrice(signal.stopPrice)}</td>
                  <td data-label="Target">{formatPrice(signal.targetPrice)}</td>
                  <td data-label="Published">{formatTimestamp(signal.publishedAt)}</td>
                  <td data-label="Status">
                    <span className={`badge badge--${status.toLowerCase()}`}>{status}</span>
                  </td>
                  <td data-label="Outcome">
                    {signal.resolved ? (
                      <span className={outcomeClassName(signal.outcome)}>{outcomeLabel(signal.outcome)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Exit">{signal.resolved ? formatPrice(signal.exitPrice) : "—"}</td>
                  <td data-label="Note" className="signal-table__note">
                    {signal.note || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
