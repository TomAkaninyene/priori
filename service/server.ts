import express, { type NextFunction, type Request, type Response } from "express";
import { ethers } from "ethers";
import { config } from "./config.js";
import { provider, wallet, signalLedger } from "./contract.js";
import { PUBLISH_SIGNAL_WITH_EXPIRY, PUBLISH_SIGNAL_DEFAULT_EXPIRY } from "./abi.js";
import { logger } from "./logger.js";
import { extractReadableError } from "./errors.js";
import {
  ApiError,
  NotFoundError,
  scalePrice,
  parseToken,
  parseDirection,
  parseScore,
  parseOutcome,
  parseSignalId,
  parseExpiresAt,
  validateDirectionalPrices,
  validateResolutionConsistency,
} from "./validation.js";

interface SignalStruct {
  id: bigint;
  token: string;
  direction: bigint;
  score: bigint;
  entryPrice: bigint;
  stopPrice: bigint;
  targetPrice: bigint;
  publishedAt: bigint;
  expiresAt: bigint;
  resolved: boolean;
  outcome: bigint;
  exitPrice: bigint;
  resolvedAt: bigint;
}

function serializeSignal(signal: SignalStruct) {
  return {
    id: signal.id.toString(),
    token: signal.token,
    direction: Number(signal.direction),
    score: Number(signal.score),
    entryPrice: signal.entryPrice.toString(),
    stopPrice: signal.stopPrice.toString(),
    targetPrice: signal.targetPrice.toString(),
    publishedAt: signal.publishedAt.toString(),
    expiresAt: signal.expiresAt.toString(),
    resolved: signal.resolved,
    outcome: Number(signal.outcome),
    exitPrice: signal.exitPrice.toString(),
    resolvedAt: signal.resolvedAt.toString(),
  };
}

async function fetchSignalOrThrow(id: bigint): Promise<SignalStruct> {
  try {
    return (await signalLedger.getSignal(id)) as unknown as SignalStruct;
  } catch (err) {
    throw new NotFoundError(`signal ${id} does not exist`);
  }
}

async function extractPublishedId(receipt: ethers.ContractTransactionReceipt): Promise<bigint> {
  for (const log of receipt.logs) {
    let parsed;
    try {
      parsed = signalLedger.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name === "SignalPublished") {
      return parsed.args.id as bigint;
    }
  }
  throw new Error("SignalPublished event not found in transaction receipt");
}

const app = express();
app.use(express.json());

app.get("/health", async (_req: Request, res: Response) => {
  const [balance, signalCount] = await Promise.all([
    provider.getBalance(wallet.address),
    signalLedger.getSignalCount() as Promise<bigint>,
  ]);
  res.json({
    status: "ok",
    walletAddress: wallet.address,
    okbBalance: ethers.formatEther(balance),
    signalCount: signalCount.toString(),
    contractAddress: config.contractAddress,
  });
});

app.get("/stats", async (_req: Request, res: Response) => {
  const stats = await signalLedger.getStats();
  res.json({
    totalPublished: stats.totalPublished.toString(),
    totalResolved: stats.totalResolved.toString(),
    wins: stats.wins.toString(),
    losses: stats.losses.toString(),
    unresolvedExpired: stats.unresolvedExpired.toString(),
  });
});

app.get("/signal/:id", async (req: Request, res: Response) => {
  const id = parseSignalId(req.params.id);
  const signal = await fetchSignalOrThrow(id);
  res.json(serializeSignal(signal));
});

app.post("/signal", async (req: Request, res: Response) => {
  const body = req.body ?? {};

  const token = parseToken(body.token);
  const direction = parseDirection(body.direction);
  const score = parseScore(body.score);
  const entryPrice = scalePrice(body.entryPrice, "entryPrice");
  const stopPrice = scalePrice(body.stopPrice, "stopPrice");
  const targetPrice = scalePrice(body.targetPrice, "targetPrice");
  validateDirectionalPrices(direction, entryPrice, stopPrice, targetPrice);
  const expiresAt = parseExpiresAt(body.expiresAt);

  const attempt = {
    token,
    direction,
    score,
    entryPrice: entryPrice.toString(),
    stopPrice: stopPrice.toString(),
    targetPrice: targetPrice.toString(),
    expiresAt: expiresAt?.toString(),
  };
  logger.info("publish attempt", attempt);

  try {
    const tx =
      expiresAt !== undefined
        ? await signalLedger[PUBLISH_SIGNAL_WITH_EXPIRY](
            token,
            direction,
            score,
            entryPrice,
            stopPrice,
            targetPrice,
            expiresAt,
          )
        : await signalLedger[PUBLISH_SIGNAL_DEFAULT_EXPIRY](
            token,
            direction,
            score,
            entryPrice,
            stopPrice,
            targetPrice,
          );
    const receipt = await tx.wait();
    const id = await extractPublishedId(receipt);
    logger.info("publish succeeded", { ...attempt, txHash: tx.hash, id: id.toString() });
    res.status(201).json({ transactionHash: tx.hash, id: id.toString() });
  } catch (err) {
    logger.error("publish failed", { ...attempt, error: extractReadableError(err) });
    throw err;
  }
});

app.post("/resolve", async (req: Request, res: Response) => {
  const body = req.body ?? {};

  const id = parseSignalId(body.id);
  const outcome = parseOutcome(body.outcome);
  const exitPrice = scalePrice(body.exitPrice, "exitPrice");

  const signal = await fetchSignalOrThrow(id);
  if (signal.resolved) {
    throw new ApiError(`signal ${id} is already resolved`, 409);
  }
  validateResolutionConsistency(
    Number(signal.direction),
    outcome,
    exitPrice,
    signal.stopPrice,
    signal.targetPrice,
  );

  const attempt = { id: id.toString(), outcome, exitPrice: exitPrice.toString() };
  logger.info("resolve attempt", attempt);

  try {
    const tx = await signalLedger.resolveSignal(id, outcome, exitPrice);
    await tx.wait();
    logger.info("resolve succeeded", { ...attempt, txHash: tx.hash });
    res.json({ transactionHash: tx.hash, id: id.toString() });
  } catch (err) {
    logger.error("resolve failed", { ...attempt, error: extractReadableError(err) });
    throw err;
  }
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof SyntaxError && "body" in (err as object)) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  const message = extractReadableError(err);
  logger.error("unhandled request error", { error: message });
  res.status(502).json({ error: message });
});

app.listen(config.port, "127.0.0.1", () => {
  logger.info("publisher service listening", {
    address: `http://127.0.0.1:${config.port}`,
    contractAddress: config.contractAddress,
    chainId: config.chainId,
    wallet: wallet.address,
  });
});
