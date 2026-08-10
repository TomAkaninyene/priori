import { ethers } from "ethers";
import { config } from "./config";
import { SIGNAL_LEDGER_ABI } from "./abi";

if (!ethers.isAddress(config.contractAddress)) {
  throw new Error(`Invalid VITE_CONTRACT_ADDRESS: ${config.contractAddress}`);
}

export const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
export const signalLedger = new ethers.Contract(config.contractAddress, SIGNAL_LEDGER_ABI, provider);
