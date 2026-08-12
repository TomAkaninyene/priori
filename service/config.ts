import "dotenv/config";

export interface ServiceConfig {
  contractAddress: string;
  chainId: number;
  rpcUrl: string;
  privateKey: string;
  port: number;
  // Old contract deployments that still have unresolved signals. /resolve
  // accepts an optional contractAddress and will write to one of these
  // instead of the primary contractAddress above -- but /signal (publish)
  // never targets these; new signals only ever go to the primary contract.
  legacyContractAddresses: string[];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig(): ServiceConfig {
  const contractAddress = requireEnv("CONTRACT_ADDRESS");
  const chainId = Number(requireEnv("CHAIN_ID"));
  const rpcUrl = requireEnv("RPC_URL");
  const privateKey = requireEnv("PRIVATE_KEY");
  const port = Number(process.env.PORT ?? "3001");
  const legacyContractAddresses = (process.env.LEGACY_CONTRACT_ADDRESSES ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address.length > 0);

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid CHAIN_ID: ${process.env.CHAIN_ID}`);
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  return { contractAddress, chainId, rpcUrl, privateKey, port, legacyContractAddresses };
}

export const config = loadConfig();
