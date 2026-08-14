import { ethers } from "ethers";
import { config } from "./config";
import { SIGNAL_LEDGER_ABI, SIGNAL_LEDGER_V1_ABI } from "./abi";

if (!ethers.isAddress(config.contractAddress)) {
  throw new Error(`Invalid VITE_CONTRACT_ADDRESS: ${config.contractAddress}`);
}

// The prior deployment, superseded by config.contractAddress (v2) on
// 2026-08-12. Still live and verified on its own address with its own
// history -- see CLAUDE.md "Deployed contracts". Not configurable via env
// since it's a fixed piece of this ledger's history, not environment-specific.
export const V1_CONTRACT_ADDRESS = "0x5380fadFeF5EaEBCE964Da4248d9327b84726Ed3";

export const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
export const signalLedgerV2 = new ethers.Contract(config.contractAddress, SIGNAL_LEDGER_ABI, provider);
export const signalLedgerV1 = new ethers.Contract(V1_CONTRACT_ADDRESS, SIGNAL_LEDGER_V1_ABI, provider);
