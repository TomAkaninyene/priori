/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL: string;
  readonly VITE_CONTRACT_ADDRESS: string;
  readonly VITE_CHAIN_ID: string;
  readonly VITE_CONVICTION_THRESHOLD?: string;
  readonly VITE_MIN_RR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
