import type { Address } from '@solana/kit';

export const CLUSTERS = ['mainnet-beta', 'devnet', 'testnet', 'localnet'] as const;
export type Cluster = (typeof CLUSTERS)[number];

export type ClusterConfig = {
  cluster: Cluster;
  label: string;
  rpcUrl: string;
  rpcWsUrl: string;
  /** Wallet Standard chain identifier passed to signing hooks. */
  chain: `solana:${string}`;
};

const DEFAULT_ENDPOINTS: Record<Cluster, { http: string; ws: string; label: string; chain: `solana:${string}` }> = {
  'mainnet-beta': {
    http: 'https://api.mainnet-beta.solana.com',
    ws: 'wss://api.mainnet-beta.solana.com',
    label: 'Mainnet',
    chain: 'solana:mainnet',
  },
  devnet: {
    http: 'https://api.devnet.solana.com',
    ws: 'wss://api.devnet.solana.com',
    label: 'Devnet',
    chain: 'solana:devnet',
  },
  testnet: {
    http: 'https://api.testnet.solana.com',
    ws: 'wss://api.testnet.solana.com',
    label: 'Testnet',
    chain: 'solana:testnet',
  },
  localnet: {
    http: 'http://127.0.0.1:8899',
    ws: 'ws://127.0.0.1:8900',
    label: 'Localnet',
    chain: 'solana:localnet',
  },
};

function isCluster(value: string): value is Cluster {
  return (CLUSTERS as readonly string[]).includes(value);
}

/** `VITE_CLUSTER` names the default cluster; `VITE_RPC_URL` / `VITE_RPC_WS_URL` override its endpoints. */
export function readEnvCluster(): Cluster {
  const raw = import.meta.env.VITE_CLUSTER;
  return typeof raw === 'string' && isCluster(raw) ? raw : 'devnet';
}

export const DEMO_MODE = import.meta.env.VITE_DEMO === '1';

export function clusterConfig(cluster: Cluster): ClusterConfig {
  const defaults = DEFAULT_ENDPOINTS[cluster];
  const envOverridden = cluster === readEnvCluster();
  const rpcUrl = (envOverridden ? import.meta.env.VITE_RPC_URL : undefined) ?? defaults.http;
  const rpcWsUrl = (envOverridden ? import.meta.env.VITE_RPC_WS_URL : undefined) ?? defaults.ws;
  return { cluster, label: defaults.label, rpcUrl, rpcWsUrl, chain: defaults.chain };
}

const EXPLORER_CLUSTER_QUERY: Record<Cluster, string> = {
  'mainnet-beta': '',
  devnet: '?cluster=devnet',
  testnet: '?cluster=testnet',
  localnet: '?cluster=custom',
};

export function explorerAccountUrl(address: Address | string, cluster: Cluster): string {
  return `https://explorer.solana.com/address/${address}${EXPLORER_CLUSTER_QUERY[cluster]}`;
}

export function explorerTxUrl(signature: string, cluster: Cluster): string {
  return `https://explorer.solana.com/tx/${signature}${EXPLORER_CLUSTER_QUERY[cluster]}`;
}
