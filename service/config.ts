import "dotenv/config";

export interface ServiceConfig {
  contractAddress: string;
  chainId: number;
  rpcUrl: string;
  privateKey: string;
  port: number;
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

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid CHAIN_ID: ${process.env.CHAIN_ID}`);
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  return { contractAddress, chainId, rpcUrl, privateKey, port };
}

export const config = loadConfig();
