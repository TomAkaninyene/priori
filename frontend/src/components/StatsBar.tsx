import { OUTCOME_EXPIRED, OUTCOME_STOP_HIT, type Signal, type Stats } from "../lib/types";

interface StatsBarProps {
  stats: Stats;
  signals: Signal[];
}

function formatHitRate(stats: Stats): string {
  const total = stats.wins + stats.losses;
  if (total === 0n) {
    return "—";
  }
  const rate = (Number(stats.wins) / Number(total)) * 100;
  return `${rate.toFixed(1)}%`;
}

// Breaks the headline losses figure down by how each resolved loss actually
// played out. Computed from the individually-fetched signals rather than
// getStats(), which only returns the aggregate count. Signals still sitting
// unresolved past expiry aren't included here -- they're already surfaced
// separately below as "Unresolved, past expiry".
function formatLossBreakdown(signals: Signal[]): string | null {
  const stopHits = signals.filter((s) => s.resolved && s.outcome === OUTCOME_STOP_HIT).length;
  const expired = signals.filter((s) => s.resolved && s.outcome === OUTCOME_EXPIRED).length;
  const total = stopHits + expired;
  if (total === 0) {
    return null;
  }
  const parts = [];
  if (stopHits > 0) {
    parts.push(`${stopHits} stop hit${stopHits === 1 ? "" : "s"}`);
  }
  if (expired > 0) {
    parts.push(`${expired} expired`);
  }
  return `${total} loss${total === 1 ? "" : "es"} — ${parts.join(", ")}`;
}

export function StatsBar({ stats, signals }: StatsBarProps) {
  // Not resolved and not yet past expiry -- still an open call.
  const pending = stats.totalPublished - stats.totalResolved - stats.unresolvedExpired;
  const lossBreakdown = formatLossBreakdown(signals);

  return (
    <section className="stats" aria-label="Ledger statistics">
      <div className="stat">
        <span className="stat__label">Published</span>
        <span className="stat__value">{stats.totalPublished.toString()}</span>
      </div>
      <div className="stat">
        <span className="stat__label">Resolved</span>
        <span className="stat__value">{stats.totalResolved.toString()}</span>
      </div>
      <div className="stat">
        <span className="stat__label">Wins</span>
        <span className="stat__value stat__value--win">{stats.wins.toString()}</span>
      </div>
      <div className="stat">
        <span className="stat__label">Losses</span>
        <span className="stat__value stat__value--loss">{stats.losses.toString()}</span>
        {lossBreakdown && <span className="stat__note">{lossBreakdown}</span>}
      </div>
      <div className="stat">
        <span className="stat__label">Hit rate</span>
        <span className="stat__value">{formatHitRate(stats)}</span>
      </div>
      <div className="stat">
        <span className="stat__label">Pending</span>
        <span className="stat__value">{pending.toString()}</span>
      </div>
      <div className="stat stat--wide">
        <span className="stat__label">Unresolved, past expiry</span>
        <span className="stat__value stat__value--loss">{stats.unresolvedExpired.toString()}</span>
        <span className="stat__note">already counted as a loss above — stalling can't improve the record</span>
      </div>
    </section>
  );
}
