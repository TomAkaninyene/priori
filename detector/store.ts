// Local record of every signal the detector has published, keyed by
// on-chain id. Used for two things: the 24h publish dedup window, and the
// resolution watcher's list of published-but-unresolved signals to keep
// checking.
import { promises as fs } from "node:fs";
import path from "node:path";
import { withFileLock } from "./fileLock.js";

export interface StoredSignal {
  id: string;
  symbol: string;
  token: string;
  direction: 1 | 2;
  conviction: number;
  deterministicScore: string; // e.g. "5/6", for logs/debugging only
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  publishedAt: string; // ISO
  expiresAt: number; // unix seconds
  resolved: boolean;
  outcome: 1 | 2 | 3 | null;
  exitPrice: number | null;
  resolvedAt: string | null;
  txHash: string;
}

export class SignalStore {
  private readonly storeFile: string;
  private readonly lockFile: string;

  constructor(stateDir: string) {
    this.storeFile = path.join(stateDir, "signals.json");
    this.lockFile = `${this.storeFile}.lock`;
  }

  async load(): Promise<StoredSignal[]> {
    try {
      return JSON.parse(await fs.readFile(this.storeFile, "utf8")) as StoredSignal[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  private async save(list: StoredSignal[]): Promise<void> {
    await fs.writeFile(this.storeFile, JSON.stringify(list, null, 2), "utf8");
  }

  async wasPublishedRecently(token: string, windowMs: number): Promise<boolean> {
    const list = await this.load();
    const cutoff = Date.now() - windowMs;
    return list.some((s) => s.token === token && new Date(s.publishedAt).getTime() >= cutoff);
  }

  async recordPublished(entry: StoredSignal): Promise<void> {
    return withFileLock(this.lockFile, async () => {
      const list = await this.load();
      list.push(entry);
      await this.save(list);
    });
  }

  async getUnresolved(): Promise<StoredSignal[]> {
    const list = await this.load();
    return list.filter((s) => !s.resolved);
  }

  async markResolved(
    id: string,
    { outcome, exitPrice, resolvedAt }: { outcome: 1 | 2 | 3; exitPrice: number; resolvedAt: string },
  ): Promise<void> {
    return withFileLock(this.lockFile, async () => {
      const list = await this.load();
      const match = list.find((s) => s.id === id);
      if (!match) return;
      match.resolved = true;
      match.outcome = outcome;
      match.exitPrice = exitPrice;
      match.resolvedAt = resolvedAt;
      await this.save(list);
    });
  }
}
