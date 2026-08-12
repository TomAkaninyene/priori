import { ethers } from "ethers";
import { config } from "./config.js";
import { SIGNAL_LEDGER_ABI } from "./abi.js";
import { ApiError } from "./validation.js";

if (!ethers.isAddress(config.contractAddress)) {
  throw new Error(`Invalid CONTRACT_ADDRESS: ${config.contractAddress}`);
}
for (const address of config.legacyContractAddresses) {
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid address in LEGACY_CONTRACT_ADDRESSES: ${address}`);
  }
}

export const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
export const wallet = new ethers.Wallet(config.privateKey, provider);
export const signalLedger = new ethers.Contract(config.contractAddress, SIGNAL_LEDGER_ABI, wallet);

const primaryAddress = ethers.getAddress(config.contractAddress);

// Same owner wallet signs for every deployment -- publishSignal is never
// called against these (new signals only ever go to the primary contract),
// but resolveSignal/getSignal need to keep working for whatever a legacy
// contract still has open.
const legacyContractsByAddress = new Map<string, ethers.Contract>(
  config.legacyContractAddresses.map((address) => [
    ethers.getAddress(address),
    new ethers.Contract(address, SIGNAL_LEDGER_ABI, wallet),
  ]),
);

export interface ResolvedContract {
  contract: ethers.Contract;
  address: string;
  isLegacy: boolean;
}

// Maps an optional, caller-supplied contract address to the contract
// instance to use for /resolve -- the primary if omitted or if it matches
// config.contractAddress, or one of the configured legacy contracts.
// Throws (400, not a 5xx) for anything else, since /resolve must never be
// able to write to an arbitrary address the caller names.
export function resolveContractFor(contractAddress: unknown): ResolvedContract {
  if (contractAddress === undefined || contractAddress === null) {
    return { contract: signalLedger, address: primaryAddress, isLegacy: false };
  }
  if (typeof contractAddress !== "string") {
    throw new ApiError("contractAddress must be a string");
  }

  let checksummed: string;
  try {
    checksummed = ethers.getAddress(contractAddress);
  } catch {
    throw new ApiError(`contractAddress is not a valid address: ${contractAddress}`);
  }

  if (checksummed === primaryAddress) {
    return { contract: signalLedger, address: checksummed, isLegacy: false };
  }

  const legacy = legacyContractsByAddress.get(checksummed);
  if (!legacy) {
    throw new ApiError(
      `Unknown contractAddress (not the primary contract or a configured legacy address): ${checksummed}`,
    );
  }
  return { contract: legacy, address: checksummed, isLegacy: true };
}
