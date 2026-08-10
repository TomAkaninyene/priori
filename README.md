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
