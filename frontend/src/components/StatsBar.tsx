import type { Stats } from "../lib/types";

interface StatsBarProps {
  stats: Stats;
}

function formatHitRate(stats: Stats): string {
  const total = stats.wins + stats.losses;
  if (total === 0n) {
    return "—";
  }
  const rate = (Number(stats.wins) / Number(total)) * 100;
  return `${rate.toFixed(1)}%`;
}

export function StatsBar({ stats }: StatsBarProps) {
  // Not resolved and not yet past expiry -- still an open call.
  const pending = stats.totalPublished - stats.totalResolved - stats.unresolvedExpired;

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
        <span className="stat__note">already counted as a loss above -- stalling can't improve the record</span>
      </div>
    </section>
  );
}
