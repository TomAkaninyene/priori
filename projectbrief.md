# Priori — Project Brief

*Living document. Update with every significant change.*

Last updated: 14 August 2026

---

## What it is

Priori is an on-chain accountability layer for AI trading judgment.

An autonomous agent publishes every trade call to a smart contract on X Layer **before the outcome is known** — token, direction, entry, stop, target, a conviction rating, and the AI's written reasoning — then resolves it against what actually happened. The record cannot be edited or deleted by anyone, including its owner.

## The problem

Crypto track records are unverifiable by construction: whoever publishes the record also controls it. Screenshots get cropped, bad calls get deleted, threads get quietly edited. Priori removes that discretion at the contract level rather than asking anyone to trust an operator's restraint.

## Architecture

Four independent parts in one repo (`/root/xlayer-signal-ledger`, GitHub `TomAkaninyene/priori`):

| Part | Path | Role |
|---|---|---|
| Contract | `contracts/` | `SignalLedger.sol` — append-only signal record |
| Publisher | `service/` | Local HTTP API that signs and submits transactions |
| Detector | `detector/` | Polls MEXC, screens candidates, calls the AI, publishes, resolves |
| Frontend | `frontend/` | Read-only dashboard reading the chain directly |

Stack: Hardhat 3, TypeScript, Mocha + Ethers v6, ESM. Vite + React for the frontend.

### Pipeline

1. **Detect** — poll MEXC public futures REST (~1,100 pairs, no API key). Prefilter on 24h rise/fall rate.
2. **Screen** — deterministic 6-point checklist: pump %, freshness, volume, funding rate, market cap, BTC trend.
3. **Judge** — survivors go to Gemini, which returns conviction 0–10, a written rationale, `pattern_confirmed`, `catalyst_clear`, and stop/target levels placed off real candle structure.
4. **Filter** — risk:reward computed **in code** from the returned levels; below the floor, no publish.
5. **Publish** — signals clearing both gates go on-chain via the publisher service, with the AI's note emitted in the event.
6. **Resolve** — every cycle, check live price against each open signal's target and stop. Fully automatic, no confirmation step.

### Process layout (pm2)

- `priori-detector` — the detection/judgment/publish/resolve loop
- `priori-publisher` — HTTP API bound to `127.0.0.1:3001` only
- `mexc-scanner` — separate project, currently on hold

## Deployments

| | Address | Chain |
|---|---|---|
| **v2 (primary)** | `0x8c23dcA66D5e1248c3fB8541Ea9d09C9136289b2` | X Layer mainnet (196) |
| v1 (legacy) | `0x5380fadFeF5EaEBCE964Da4248d9327b84726Ed3` | X Layer mainnet (196) |
| testnet | `0x5380fadFeF5EaEBCE964Da4248d9327b84726Ed3` | X Layer testnet (1952) |

Both mainnet contracts are Sourcify-verified. v1 holds the first four signals, all resolved; the frontend merges both histories into one table with a per-row version label.

Frontend: https://priori-delta-nine.vercel.app/
X account: [@priori_hq](https://x.com/priori_hq)

## Design decisions and why

**The contract has no escape hatches.** No edit, delete, pause, upgrade, ownership-transfer, or admin override. No `selfdestruct`. The owner is `immutable`, set once in the constructor. This means losing the deploying key permanently freezes the contract — accepted deliberately, because any recovery mechanism is also a tampering mechanism.

**Unresolved past expiry counts as a loss.** The obvious cheat against an append-only ledger is to simply never resolve the losers. `getStats` folds unresolved-expired signals into the loss tally, so silence scores the same as a stop-out. This constraint *is* the product.

**Every signal carries a 24-hour window.** If price reaches neither target nor stop before expiry, that still counts as a loss — the timeframe is part of the call, not just the direction. This is conservative in the direction that makes the record look worse, which is the correct direction for this project.

**Resolution validates against the signal's own data.** `resolveSignal` checks the reported exit price against the stored stop and target for that direction. An outcome cannot be recorded that contradicts its own numbers. It doesn't make lying impossible — there's no oracle — but any lie must be internally consistent and permanently visible on-chain.

**Outcome 3 (expired) requires `block.timestamp >= expiresAt`.** Added in v2. Without it, a live signal could be declared expired early.

**The AI's reasoning is emitted, not stored.** Storage gas for a 500-char string is expensive; events are permanently on-chain and readable from logs at a fraction of the cost. The frontend reads notes via `queryFilter` on `SignalPublished`. v1 predates this field, so those rows show `—`.

**Conviction rates pattern quality only; risk:reward is a separate gate.** An attempt to fold R:R guidance into the conviction prompt was reverted — it depressed every rating (a candidate at 8.24:1 scored 2), rather than selectively penalising weak setups. Two mechanisms each doing one job works better than one doing both.

**R:R is computed in code, never parsed from the model's prose.** Gemini's self-reported ratio in `conviction_note` has been observed to be arithmetically wrong. The code calculates it from the raw numbers.

**Everything fails closed.** A malformed or missing conviction, a bad price level, an unreachable publisher — all skip the publish and log. Nothing unvalidated reaches the chain.

**The publisher binds to localhost only.** It holds a key that spends real funds on a VPS with a public IP. Verified empirically with `ss -tlnp`, not just assumed from config.

**The frontend reads the chain directly.** No backend, no database, no API keys. If the VPS dies the dashboard still works, and anyone can reproduce the numbers with their own tools. This is the pitch working end to end.

**v1 signals were never republished to v2.** Republishing would stamp them with a current `block.timestamp` — writing calls to the chain with knowledge of how they'd been going. That's precisely the fraud Priori exists to prevent.

## Configuration

All in `.env`, documented in `.env.example`.

| Variable | Current | Notes |
|---|---|---|
| `DETECTOR_PREFILTER_RISE_RATE` | 0.2 | 20% absolute 24h move |
| `DETERMINISTIC_THRESHOLD` | 6 | Of 6 — currently the maximum |
| `DETECTOR_CONVICTION_THRESHOLD` | 6 | Of 10 |
| `DETECTOR_MIN_RR` | 1.2 | Lowered from 1.5 after observing real candidates cluster at 0.76–1.48 |
| `GEMINI_SYMBOL_COOLDOWN_MINUTES` | 60 | Lowered from 240 |
| `DETECTOR_FALLBACK_TO_FORMULA_LEVELS` | false | Skip rather than substitute derived levels |
| `LEGACY_CONTRACT_ADDRESSES` | v1 | Resolver-only; publishing always targets primary |

The frontend's `VITE_CONVICTION_THRESHOLD` and `VITE_MIN_RR` are **manually mirrored** from the detector's config — they are not live-read. Keep them in sync or the site misstates how its own record was produced.

## Gotchas

**`--build-profile production` is required for both deploy and verify.** Ignition deploys with the production profile (optimizer on, 200 runs); `hardhat verify` recompiles with the default profile unless told otherwise, producing a bytecode mismatch.

**The public RPC caps `eth_getLogs` at 100 blocks.** An unbounded `queryFilter` fails in production even when it passes against a local Hardhat node. Note lookups derive the target block from each signal's `publishedAt` against a ~1s block time, then widen through ±3, ±15, ±49 before giving up.

**v1 and v2 have independent id sequences.** Both start at 1. Anything keyed on id alone — local bookkeeping, React keys, resolution routing — must also carry the contract address.

**pm2 caches environment on start.** Use `--update-env` on restart or config changes silently don't apply.

**Restart the publisher before the detector.** The detector fetches the primary contract address from the publisher's `/health` at startup.

**Never `cat .env`.** Terminal screenshots go public as part of building in public; the signing key is in there and cannot be rotated.

## Current state

Full pipeline proven end to end on mainnet: detection, AI conviction with reasoning, on-chain publish, and automatic resolution — all unattended.

Record so far (v1, all resolved): 1 target hit, 1 stop hit, 2 expired unresolved. v2 accumulating at roughly one signal per day.

Hit rate is displayed but should be read against the sample size; a dozen signals is not a track record.

## Known gaps

- The candidate pool is genuinely narrow — 3–4 symbols clear the deterministic screen per cycle, out of ~1,100 pairs. Investigated from both ends; not a config artifact.
- `getStats` loops every signal. Fine at hackathon scale, will slow at thousands.
- `gemini-flash-lite-latest` is a rolling alias — the model behind it can change without notice, which means conviction 6 may not mean the same thing across the record's lifetime.
- The chain stores the record; it doesn't execute the trades. Deeper X Layer integration would mean routing execution on-chain.
