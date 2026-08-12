# Priori

Priori is an on-chain, append-only ledger of trading signals: signals are published before their outcome is known, and the contract has no edit, delete, pause, or upgrade function for anyone, including its owner. A signal left unresolved past its expiry counts as a loss in the effective record. Each signal can carry a free-text note (up to `MAX_NOTE_LENGTH` = 500 bytes) explaining the reasoning behind it -- but the note lives only in the `SignalPublished` event, never in the `Signal` struct itself, so it costs no storage gas and is read from event logs, not from `getSignal()`. The frontend does this via `signalLedger.queryFilter(signalLedger.filters.SignalPublished())` and matches notes back to signals by `id` (see `frontend/src/hooks/useSignalLedger.ts`).

Deployed contracts, both `SignalLedger` on X Layer mainnet, chain ID `196` (RPC `https://rpc.xlayer.tech`), both verified on Sourcify:

- **Primary (current):** `0x8c23dcA66D5e1248c3fB8541Ea9d09C9136289b2` -- `service/`'s `CONTRACT_ADDRESS`. All new signals publish here.
- **Legacy (resolver-only):** `0x5380fadFeF5EaEBCE964Da4248d9327b84726Ed3` -- the prior deployment, before `note` and the expiry-gated `resolveSignal` outcome-3 check were added. It still had unresolved signals at the time of the v2 redeploy, so it stays in `service/`'s `LEGACY_CONTRACT_ADDRESSES` and the detector's local store keeps tracking those specific signals against it (tagged per-signal with `contractAddress`, fetched from the publisher's own `/health` at publish time -- see `detector/index.ts` and `detector/resolver.ts`). `POST /resolve` accepts an optional `contractAddress`, checked against a whitelist of the primary plus every configured legacy address; `POST /signal` (publish) has no such option and only ever targets the primary. Remove an address from `LEGACY_CONTRACT_ADDRESSES` once every signal on it is resolved.

**Verification note:** every deployment here was done via Ignition using the `production` build profile (optimizer on, 200 runs). `hardhat run`/`hardhat verify` recompile with the `default` profile (optimizer off) unless told otherwise, so local bytecode won't match on-chain bytecode without passing `--build-profile production` explicitly to **both** the Ignition deploy and `hardhat verify` -- a mismatched profile on either one produces bytecode that won't match what's actually on-chain.

## Project layout

Four independent parts:

```
contracts/        Solidity source (SignalLedger.sol) and unit tests (*.t.sol)
test/             TypeScript integration tests and Solidity unit tests (*.sol)
ignition/         Hardhat Ignition deployment modules
scripts/          Standalone scripts run with `hardhat run`
hardhat.config.ts

service/          Standalone Express HTTP API that publishes/resolves signals
                   on-chain (owner-only writes). Independent of the Hardhat CLI --
                   plain ethers v6, config from .env via dotenv. Binds to
                   127.0.0.1 ONLY -- must never be reachable from the public
                   internet, since it holds the deployer PRIVATE_KEY. Holds a
                   Contract instance per deployment (primary + each address in
                   LEGACY_CONTRACT_ADDRESSES, all signed by the same owner
                   wallet) so /resolve can still write to a contract that's
                   been superseded; /signal (publish) only ever uses the
                   primary.

frontend/          Priori: read-only Vite + React + TypeScript dashboard.
                   Reads SignalLedger directly from chain via a public RPC --
                   no backend, no API keys, no wallet connection. Deployable
                   to Vercel as a static site. Has its own tsconfig/build
                   pipeline; the root tsconfig.json excludes frontend/ so
                   `npx tsc --noEmit` at the repo root doesn't try to
                   typecheck its JSX/bundler-mode files under Node module
                   settings. Its VITE_CONVICTION_THRESHOLD / VITE_MIN_RR (used
                   only for the "what filter produced this record" line under
                   the stats bar) are not read from the detector at runtime --
                   this frontend has no backend -- so they have to be kept in
                   sync by hand with the detector's actual configured
                   DETECTOR_CONVICTION_THRESHOLD / DETECTOR_MIN_RR whenever
                   those change; see the comments in frontend/src/lib/config.ts.

detector/          Self-contained signal generator: polls MEXC's public
                   futures API (free, no key) for the pump-and-fade short
                   setup and screens with a deterministic checklist. Survivors
                   go to a pluggable conviction provider (Gemini by default,
                   behind an interface in convictionProvider.ts so another
                   model can be swapped in via CONVICTION_PROVIDER without
                   touching detection or publishing) which rates pattern/setup
                   quality only -- conviction says nothing about risk:reward.
                   Risk:reward is a separate, independent hard gate
                   (DETECTOR_MIN_RR, checked after the conviction threshold,
                   on the final entry/stop/target regardless of source) that
                   must also pass before a signal publishes. Publishes/resolves
                   through service/ over HTTP -- independent of the Hardhat CLI
                   and of any other project, plain TypeScript run via `tsx`,
                   own state under detector/state/ (gitignored). Every stored
                   signal is tagged with the contract address it was actually
                   published to (fetched from the publisher's own /health, not
                   hardcoded), so its resolver can keep resolving signals
                   against a legacy contract after a redeploy while new
                   publishes go only to the current primary. See README.md
                   "Detector" section for the full pipeline and env vars.
```

## Env vars

Root `.env` (dotenv, gitignored -- see `.env.example`):
- `PRIVATE_KEY` -- deployer/owner key, used by `hardhat.config.ts` (xlayerTestnet network) and by `service/` to sign transactions.
- `CONTRACT_ADDRESS`, `CHAIN_ID`, `RPC_URL` -- used by `service/`.
- `LEGACY_CONTRACT_ADDRESSES` -- optional, comma-separated, used by `service/` (see "Deployed contracts" above).
- `PORT` -- optional, service listen port, defaults to 3001.
- `detector/` reads its own set of `DETECTOR_*`, `GEMINI_*`, `MEXC_FUTURES_BASE_URL`, `CONVICTION_PROVIDER`, and `PRIORI_PUBLISHER_URL` vars from the same root `.env` -- see `.env.example` and README.md "Detector" for the full list and defaults.

`frontend/.env` (separate file, its own `.env.example`):
- `VITE_RPC_URL`, `VITE_CONTRACT_ADDRESS`, `VITE_CHAIN_ID` -- public, no secrets.
- `VITE_CONVICTION_THRESHOLD`, `VITE_MIN_RR` -- optional, informational only; must be kept in sync by hand with the detector's config (see the `frontend/` entry in Project layout above).

## Working in this project

When writing or modifying tests, configuring `hardhat.config.ts`, or interacting with the network from TypeScript, invoke the **`hardhat`** skill. It covers Solidity and TypeScript testing, how to choose between them, `forge-std` cheatcodes, the `network.create()` API, `networkHelpers`, and the compile-then-typecheck workflow. The skill itself points to the matching `hardhat-toolbox-*` skill for toolbox-specific guidance (signers, contract interaction, assertions).

## Docs

- Hardhat 3 — https://hardhat.org/llms.txt
- ethers.js — https://docs.ethers.org/v6/
