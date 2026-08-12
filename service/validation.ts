import { ethers } from "ethers";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(message, 404);
  }
}

const DIRECTION_SHORT = 1;
const DIRECTION_LONG = 2;

// Mirrors SignalLedger.MAX_NOTE_LENGTH -- kept in sync by hand, same as the
// rest of this file mirrors the contract's other require() checks.
const MAX_NOTE_LENGTH = 500;

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

// Prices arrive as plain decimals (e.g. 3000.5) and are scaled by 1e8 to
// match the contract's fixed-point representation. Parsing through a
// decimal string (rather than floating-point arithmetic) avoids rounding
// drift before the value is submitted on-chain.
export function scalePrice(value: unknown, field: string): bigint {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new ApiError(`${field} must be a number or numeric string`);
  }
  const str = String(value).trim();
  if (!DECIMAL_PATTERN.test(str)) {
    throw new ApiError(`${field} must be a positive decimal number`);
  }

  let scaled: bigint;
  try {
    scaled = ethers.parseUnits(str, 8);
  } catch {
    throw new ApiError(`${field} is not a valid decimal number`);
  }
  if (scaled <= 0n) {
    throw new ApiError(`${field} must be greater than zero`);
  }
  return scaled;
}

export function parseToken(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError("token must be a non-empty string");
  }
  return value;
}

export function parseDirection(value: unknown): typeof DIRECTION_SHORT | typeof DIRECTION_LONG {
  const direction = Number(value);
  if (direction !== DIRECTION_SHORT && direction !== DIRECTION_LONG) {
    throw new ApiError("direction must be 1 (short) or 2 (long)");
  }
  return direction;
}

export function parseScore(value: unknown): number {
  const score = Number(value);
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    throw new ApiError("score must be an integer between 0 and 10");
  }
  return score;
}

export function parseOutcome(value: unknown): 1 | 2 | 3 {
  const outcome = Number(value);
  if (outcome !== 1 && outcome !== 2 && outcome !== 3) {
    throw new ApiError("outcome must be 1 (target hit), 2 (stop hit), or 3 (expired)");
  }
  return outcome;
}

// note is optional; missing/undefined publishes with an empty note. Length
// is checked in UTF-8 bytes (not JS string length) to match Solidity's
// bytes(note).length exactly, so this fails locally instead of reverting
// on-chain and burning gas on a note that's fine by JS string length but
// too long once multi-byte characters are UTF-8 encoded.
export function parseNote(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new ApiError("note must be a string");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_NOTE_LENGTH) {
    throw new ApiError(`note must be ${MAX_NOTE_LENGTH} bytes (UTF-8) or fewer`);
  }
  return value;
}

export function parseSignalId(value: unknown): bigint {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError("id must be a positive integer");
  }
  return BigInt(id);
}

// expiresAt, when provided, is a Unix timestamp in seconds (matching the
// contract's block.timestamp-based field) -- not a price, so it is not
// scaled by 1e8.
export function parseExpiresAt(value: unknown): bigint | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new ApiError("expiresAt must be a positive integer unix timestamp (seconds)");
  }
  const expiresAt = BigInt(seconds);
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (expiresAt <= nowSeconds) {
    throw new ApiError("expiresAt must be in the future");
  }
  return expiresAt;
}

// Mirrors the require() checks in SignalLedger._publish so bad directional
// input fails locally instead of reverting on-chain and burning gas.
export function validateDirectionalPrices(
  direction: number,
  entryPrice: bigint,
  stopPrice: bigint,
  targetPrice: bigint,
): void {
  if (direction === DIRECTION_SHORT) {
    if (!(stopPrice > entryPrice)) {
      throw new ApiError("short stopPrice must be above entryPrice");
    }
    if (!(targetPrice < entryPrice)) {
      throw new ApiError("short targetPrice must be below entryPrice");
    }
  } else {
    if (!(stopPrice < entryPrice)) {
      throw new ApiError("long stopPrice must be below entryPrice");
    }
    if (!(targetPrice > entryPrice)) {
      throw new ApiError("long targetPrice must be above entryPrice");
    }
  }
}

// Mirrors the consistency checks in SignalLedger.resolveSignal so an
// exitPrice that contradicts its claimed outcome fails locally instead of
// reverting on-chain and burning gas.
export function validateResolutionConsistency(
  direction: number,
  outcome: number,
  exitPrice: bigint,
  stopPrice: bigint,
  targetPrice: bigint,
): void {
  if (outcome === 1) {
    if (direction === DIRECTION_SHORT) {
      if (!(exitPrice <= targetPrice)) {
        throw new ApiError("exitPrice does not confirm target hit for a short signal (must be <= targetPrice)");
      }
    } else {
      if (!(exitPrice >= targetPrice)) {
        throw new ApiError("exitPrice does not confirm target hit for a long signal (must be >= targetPrice)");
      }
    }
  } else if (outcome === 2) {
    if (direction === DIRECTION_SHORT) {
      if (!(exitPrice >= stopPrice)) {
        throw new ApiError("exitPrice does not confirm stop hit for a short signal (must be >= stopPrice)");
      }
    } else {
      if (!(exitPrice <= stopPrice)) {
        throw new ApiError("exitPrice does not confirm stop hit for a long signal (must be <= stopPrice)");
      }
    }
  }
}
