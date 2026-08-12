// Minimal cross-process lock for the JSON-file-as-database pattern used by
// store.ts and rateLimiter.ts. Lock via exclusive file creation (fails if
// the lock already exists) so a lost update can't silently drop a write.
import { promises as fs } from "node:fs";

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5000;
// A lock older than this is assumed abandoned by a crashed process rather
// than actively held -- stale locks would otherwise deadlock every future
// writer forever.
const STALE_LOCK_MS = 10000;

async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.close();
      return;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") throw err;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          await fs.unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        continue; // lock disappeared between the failed open and stat -- retry
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  await fs.unlink(lockPath).catch((e) => {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  });
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath);
  }
}
