// Turns ethers/RPC failures into a short, readable message instead of a raw
// stack trace. Ethers v6 errors typically carry a `shortMessage` or `reason`;
// this falls back progressively rather than leaking internal error shapes.
export function extractReadableError(err: unknown): string {
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.shortMessage === "string") {
      return anyErr.shortMessage;
    }
    if (typeof anyErr.reason === "string") {
      return anyErr.reason;
    }
    const info = anyErr.info;
    if (info && typeof info === "object") {
      const innerError = (info as Record<string, unknown>).error;
      if (innerError && typeof innerError === "object") {
        const message = (innerError as Record<string, unknown>).message;
        if (typeof message === "string") {
          return message;
        }
      }
    }
    if (typeof anyErr.message === "string") {
      return anyErr.message;
    }
  }
  return "Unexpected error";
}
