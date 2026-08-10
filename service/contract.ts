import { ethers } from "ethers";
import { config } from "./config.js";
import { SIGNAL_LEDGER_ABI } from "./abi.js";

if (!ethers.isAddress(config.contractAddress)) {
  throw new Error(`Invalid CONTRACT_ADDRESS: ${config.contractAddress}`);
}

export const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
export const wallet = new ethers.Wallet(config.privateKey, provider);
export const signalLedger = new ethers.Contract(config.contractAddress, SIGNAL_LEDGER_ABI, wallet);
