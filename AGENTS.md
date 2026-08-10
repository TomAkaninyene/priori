# Priori

Priori is an on-chain, append-only ledger of trading signals: signals are published before their outcome is known, and the contract has no edit, delete, pause, or upgrade function for anyone, including its owner. A signal left unresolved past its expiry counts as a loss in the effective record.

Deployed contract: `SignalLedger` at `0x5380fadFeF5EaEBCE964Da4248d9327b84726Ed3` on X Layer testnet, chain ID `1952` (RPC `https://testrpc.xlayer.tech/terigon`). Verified on Sourcify.

**Verification note:** the contract was deployed via Ignition using the `production` build profile (optimizer on, 200 runs). `hardhat run`/`hardhat verify` recompile with the `default` profile (optimizer off) unless told otherwise, so local bytecode won't match on-chain bytecode without passing `--build-profile production` explicitly — needed for `hardhat verify` and any bytecode comparison against this deployment.

## Project layout

Three independent parts:

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
                   internet, since it holds the deployer PRIVATE_KEY.

frontend/          Priori: read-only Vite + React + TypeScript dashboard.
                   Reads SignalLedger directly from chain via a public RPC --
                   no backend, no API keys, no wallet connection. Deployable
                   to Vercel as a static site. Has its own tsconfig/build
                   pipeline; the root tsconfig.json excludes frontend/ so
                   `npx tsc --noEmit` at the repo root doesn't try to
                   typecheck its JSX/bundler-mode files under Node module
                   settings.
```

## Env vars

Root `.env` (dotenv, gitignored -- see `.env.example`):
- `PRIVATE_KEY` -- deployer/owner key, used by `hardhat.config.ts` (xlayerTestnet network) and by `service/` to sign transactions.
- `CONTRACT_ADDRESS`, `CHAIN_ID`, `RPC_URL` -- used by `service/`.
- `PORT` -- optional, service listen port, defaults to 3001.

`frontend/.env` (separate file, its own `.env.example`):
- `VITE_RPC_URL`, `VITE_CONTRACT_ADDRESS`, `VITE_CHAIN_ID` -- public, no secrets.

## Working in this project

When writing or modifying tests, configuring `hardhat.config.ts`, or interacting with the network from TypeScript, invoke the **`hardhat`** skill. It covers Solidity and TypeScript testing, how to choose between them, `forge-std` cheatcodes, the `network.create()` API, `networkHelpers`, and the compile-then-typecheck workflow. The skill itself points to the matching `hardhat-toolbox-*` skill for toolbox-specific guidance (signers, contract interaction, assertions).

## Docs

- Hardhat 3 — https://hardhat.org/llms.txt
- ethers.js — https://docs.ethers.org/v6/
