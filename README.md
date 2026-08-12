# Sample Hardhat 3 Project (`mocha` and `ethers`)

This project showcases a Hardhat 3 project using `mocha` for tests and the `ethers` library for Ethereum interactions.

To learn more about Hardhat 3, please visit the [Getting Started guide](https://hardhat.org/docs/getting-started#getting-started-with-hardhat-3). To share your feedback, join our [Hardhat 3](https://hardhat.org/hardhat3-telegram-group) Telegram group or [open an issue](https://github.com/NomicFoundation/hardhat/issues/new) in our GitHub issue tracker.

## Project Overview

This example project includes:

- A simple Hardhat configuration file.
- Foundry-compatible Solidity unit tests.
- TypeScript integration tests using `mocha` and ethers.js
- Examples demonstrating how to connect to different types of networks, including locally simulating OP mainnet.

## Usage

### Running Tests

To run all the tests in the project, execute the following command:

```shell
npx hardhat test
```

You can also selectively run the Solidity or `mocha` tests:

```shell
npx hardhat test solidity
npx hardhat test mocha
```

### Make a deployment to Sepolia

This project includes an example Ignition module to deploy the contract. You can deploy this module to a locally simulated chain or to Sepolia.

To run the deployment to a local chain:

```shell
npx hardhat ignition deploy ignition/modules/Counter.ts
```

To run the deployment to Sepolia, you need an account with funds to send the transaction. The provided Hardhat configuration includes a Configuration Variable called `SEPOLIA_PRIVATE_KEY`, which you can use to set the private key of the account you want to use.

You can set the `SEPOLIA_PRIVATE_KEY` variable using the `hardhat-keystore` plugin or by setting it as an environment variable.

To set the `SEPOLIA_PRIVATE_KEY` config variable using `hardhat-keystore`:

```shell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

After setting the variable, you can run the deployment with the Sepolia network:

```shell
npx hardhat ignition deploy --network sepolia ignition/modules/Counter.ts
```

## Publisher service

`service/` is a standalone Express HTTP API that publishes and resolves signals on the deployed `SignalLedger` contract. It's independent of the Hardhat CLI — it reads its own configuration from `.env` and talks to the chain directly via `ethers`.

### Configuration

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
| --- | --- |
| `PRIVATE_KEY` | Private key of the wallet that signs `publishSignal`/`resolveSignal` transactions (must be the contract owner). |
| `CONTRACT_ADDRESS` | Deployed `SignalLedger` address. |
| `CHAIN_ID` | Chain ID of the target network (`1952` for X Layer testnet). |
| `RPC_URL` | JSON-RPC endpoint for the target network. |
| `PORT` | Port to listen on. Optional, defaults to `3001`. |

### Running

```shell
npm run service
```

The service binds to `127.0.0.1` only — it is never reachable from outside the host.

### Endpoints

All prices (`entryPrice`, `stopPrice`, `targetPrice`, `exitPrice`) are sent as plain decimals in the request body; the service scales them by `1e8` before submitting to the contract. Response bodies return the raw on-chain (already-scaled) values as strings, since they can exceed `Number.MAX_SAFE_INTEGER`.

Before submitting a transaction, the service replicates the contract's `require()` checks locally — direction/score bounds, stop/target price ordering, and (for `/resolve`) exit-price consistency with the claimed outcome — so invalid input returns a `400` immediately instead of reverting on-chain and burning gas.

#### `GET /health`

Wallet address, native token (OKB) balance, current signal count, and the configured contract address.

```shell
curl http://127.0.0.1:3001/health
```

#### `POST /signal`

Publishes a new signal. `expiresAt` is optional (a Unix timestamp in seconds); if omitted, the contract defaults it to 24 hours from publish time. Returns the transaction hash and the assigned signal id.

```shell
curl -X POST http://127.0.0.1:3001/signal \
  -H "Content-Type: application/json" \
  -d '{
    "token": "ETH",
    "direction": 2,
    "score": 7,
    "entryPrice": 3000.5,
    "stopPrice": 2900.25,
    "targetPrice": 3200.75
  }'
```

```json
{ "transactionHash": "0x...", "id": "1" }
```

#### `POST /resolve`

Resolves an existing signal. `outcome` is `1` (target hit), `2` (stop hit), or `3` (expired unresolved).

```shell
curl -X POST http://127.0.0.1:3001/resolve \
  -H "Content-Type: application/json" \
  -d '{ "id": 1, "outcome": 1, "exitPrice": 3200.75 }'
```

```json
{ "transactionHash": "0x...", "id": "1" }
```

#### `GET /stats`

The contract's aggregate track record. `unresolvedExpired` is exposed separately, but is already folded into `losses` by the contract (see `getStats` in `contracts/SignalLedger.sol`).

```shell
curl http://127.0.0.1:3001/stats
```

```json
{ "totalPublished": "4", "totalResolved": "3", "wins": "1", "losses": "2", "unresolvedExpired": "0" }
```

#### `GET /signal/:id`

A single signal, or `404` if the id doesn't exist.

```shell
curl http://127.0.0.1:3001/signal/1
```

## Detector

`detector/` is a self-contained signal generator for Priori. It polls MEXC's public futures API on an
interval (free, no API key), screens pairs against a deterministic checklist for a pump-and-fade short
setup, sends candidates that clear the screen to a conviction provider for a 0-10 rating, and publishes/
resolves signals through the publisher service above. It has no dependency on any other project -- it's
independent in the same way `service/` is.

### Pipeline

1. **Detection (free, unmetered).** Every `DETECTOR_POLL_INTERVAL_MS`, fetch all MEXC futures tickers, pre-filter
   by 24h price change (`DETECTOR_PREFILTER_RISE_RATE`), then for pairs that pass, fetch recent candles and score
   six deterministic checklist items: pumped 50%+ from a recent base, pump age under 6h (or still visibly rolling
   over), declining volume, funding rate not too negative, market cap under $500M, and BTC not in a strong
   uptrend. Candidates need `DETECTOR_DETERMINISTIC_THRESHOLD` items passing (out of 6) to proceed. Nothing here
   costs money or calls a rate-limited API.
2. **Conviction (Gemini free tier).** Candidates that clear the screen are sent to a `ConvictionProvider` --
   symbol, current/base/peak price, funding rate, market cap, and the last ~20 candles -- and asked for strict
   JSON: `conviction` (integer 0-10, rating pattern/setup quality), `conviction_note`, `pattern_confirmed`,
   `catalyst_clear`, `stop_price`, and `target_price` (the model's own suggested short levels, placed off the real
   candle structure -- swing high, base retracement -- rather than a formula). Risk:reward is not part of the
   conviction rating itself; it's enforced separately as a hard gate (step 5). The provider sits behind an
   interface (`detector/convictionProvider.ts`); Gemini is the only implementation today
   (`detector/geminiProvider.ts`), selected via `CONVICTION_PROVIDER`. Swapping in Claude or another model means
   implementing that interface and adding a case to `createConvictionProvider()` -- detection and publishing code
   doesn't change.
3. **Validation (fail closed).** Whatever a provider returns is treated as untrusted until
   `validateConvictionResponse()` confirms `conviction` is an integer in `[0, 10]` and the other core fields are
   present with the right types -- malformed JSON, a missing field, or an out-of-range score is logged and the
   candidate is skipped, no matter which provider produced it. `stop_price`/`target_price` get their own check:
   both must be finite positive numbers and directionally correct for a short (`stop_price` above entry,
   `target_price` below) or they're treated as absent (see step 5).
4. **Rate and cost control.** Before any conviction call, `detector/rateLimiter.ts` checks three things:
   a per-minute cap, a per-day cap (persisted to disk so it survives restarts), and a per-symbol cooldown (so a
   pair that keeps qualifying isn't re-judged every cycle). Any cap hit is logged and that symbol is skipped for
   the cycle -- nothing is queued or retried later. If Gemini itself returns 429, `geminiProvider.ts` retries with
   exponential backoff up to `GEMINI_MAX_RETRIES` before giving up on that symbol for the cycle.
5. **Risk:reward filter.** Checked after the conviction threshold, on whichever entry/stop/target are about to be
   published (Gemini's or the formula fallback's): `reward:risk = (entry - target) / (stop - entry)` must clear
   `DETECTOR_MIN_RR` (default 1.5). The computed ratio is logged for every candidate that reaches this point,
   whether or not it goes on to publish, so the R:R distribution across candidates is visible in the logs. Below
   the minimum, the candidate is skipped and the symbol, ratio, and levels that produced it are logged.
6. **Publishing.** A candidate with `conviction >= DETECTOR_CONVICTION_THRESHOLD` (default 7) that clears the
   risk:reward filter above is published via `POST /signal` on the publisher service, direction always short,
   using Gemini's own `stop_price`/`target_price` from step 2. If those are missing or failed the directional
   check, the candidate is skipped (fail closed) unless `DETECTOR_FALLBACK_TO_FORMULA_LEVELS=true`, in which case
   a deterministic formula stands in instead: stop at `DETECTOR_STOP_BUFFER_PCT` above the swing high since the
   pump started, target at `DETECTOR_TARGET_RR_MULTIPLE` multiples of that risk below entry. A token that was
   already published within the last 24h is skipped either way (dedup).
7. **Resolution watcher.** Every cycle, before anything conviction-related, every published-but-unresolved signal
   is checked against that cycle's already-fetched prices: target touched first resolves outcome `1`, stop
   touched first resolves outcome `2`, neither before `expiresAt` resolves outcome `3` at the current price. Fully
   automatic, no confirmation step, and it runs even when the day's conviction-call budget is exhausted, since it
   only uses free price data already in hand.

A Gemini failure, a publisher failure, or an MEXC/RPC failure at any stage is logged and the detector moves on --
nothing here can crash the polling loop.

### Configuration

All of the above is tunable via `.env` (see `.env.example` for the full list with defaults): poll interval,
pre-filter and deterministic thresholds, `CONVICTION_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL` (defaults to
`gemini-flash-lite-latest`, Google's rolling alias for the current highest-daily-quota free-tier Flash-Lite
model -- pinned Flash-Lite versions get retired for new API keys over time, so the alias is used instead of a
pinned version; check [ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits)
for current numbers before tuning the rate caps below it), `GEMINI_MAX_REQUESTS_PER_MINUTE`, `GEMINI_MAX_REQUESTS_PER_DAY`,
`GEMINI_SYMBOL_COOLDOWN_MINUTES`, `DETECTOR_CONVICTION_THRESHOLD`, `DETECTOR_MIN_RR` (the risk:reward floor from
step 5, default 1.5), `DETECTOR_FALLBACK_TO_FORMULA_LEVELS` (off by default -- see step 6 above), the
fallback-only `DETECTOR_STOP_BUFFER_PCT`/`DETECTOR_TARGET_RR_MULTIPLE`, and `PRIORI_PUBLISHER_URL` (the publisher
service above, which must be running).

### Running

```shell
npm run detector
```

State (published-signal records, the daily Gemini call count, per-symbol cooldowns) is kept in
`detector/state/*.json`, gitignored, and persists across restarts.

## Frontend

`frontend/` is Priori, a read-only Vite + React + TypeScript dashboard for the `SignalLedger` contract. It talks directly to the chain over a public RPC endpoint using `ethers` -- there's no backend, no API keys, and no connection to the publisher service. It's a static site: build it and deploy the output anywhere that serves static files.

### Local dev

```shell
cd frontend
npm install
cp .env.example .env
npm run dev
```

Configuration comes entirely from env vars (see `frontend/.env.example`):

| Variable | Description |
| --- | --- |
| `VITE_RPC_URL` | Public JSON-RPC endpoint to read from. |
| `VITE_CONTRACT_ADDRESS` | Deployed `SignalLedger` address. |
| `VITE_CHAIN_ID` | Chain ID of the target network (`1952` for X Layer testnet). |

### Build

```shell
cd frontend
npm run build
```

Outputs a static site to `frontend/dist`.

### Deploying to Vercel

1. Import this repository into Vercel.
2. Set the project's **Root Directory** to `frontend`.
3. Framework preset: **Vite** (Vercel detects this automatically; build command `npm run build`, output directory `dist`).
4. Add the three env vars above (`VITE_RPC_URL`, `VITE_CONTRACT_ADDRESS`, `VITE_CHAIN_ID`) in the Vercel project settings.
5. Deploy. Since it's a static site with no server-side code, no other configuration is needed.
