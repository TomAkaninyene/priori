export interface AppConfig {
  rpcUrl: string;
  contractAddress: string;
  chainId: number;
}

function readEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig(): AppConfig {
  const rpcUrl = readEnv("VITE_RPC_URL");
  const contractAddress = readEnv("VITE_CONTRACT_ADDRESS");
  const chainId = Number(readEnv("VITE_CHAIN_ID"));

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid VITE_CHAIN_ID: ${import.meta.env.VITE_CHAIN_ID}`);
  }

  return { rpcUrl, contractAddress, chainId };
}

export const config = loadConfig();
