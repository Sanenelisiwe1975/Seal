import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEMO_MODE, clusterConfig, readEnvCluster, type Cluster, type ClusterConfig } from '../lib/cluster';
import { createDemoApi } from '../demo/demoApi';
import { createRpcApi } from './rpcApi';
import { createRpcClients } from './rpcClient';
import type { SealApi } from './types';

type SealApiContextValue = {
  api: SealApi;
  cluster: Cluster;
  config: ClusterConfig;
  setCluster: (cluster: Cluster) => void;
  demo: boolean;
};

const SealApiContext = createContext<SealApiContextValue | null>(null);

const CLUSTER_STORAGE_KEY = 'seal.cluster';

function initialCluster(): Cluster {
  const stored = globalThis.localStorage?.getItem(CLUSTER_STORAGE_KEY);
  const fromEnv = readEnvCluster();
  if (!stored) return fromEnv;
  return stored === 'mainnet-beta' || stored === 'devnet' || stored === 'testnet' || stored === 'localnet'
    ? stored
    : fromEnv;
}

/**
 * Builds the data layer for the selected cluster. Demo mode swaps the whole implementation here, so
 * no component or hook below this point knows which one it is talking to.
 */
export function SealApiProvider({ children }: { children: ReactNode }) {
  const [cluster, setClusterState] = useState<Cluster>(initialCluster);

  const value = useMemo<SealApiContextValue>(() => {
    const config = clusterConfig(cluster);
    const api = DEMO_MODE ? createDemoApi() : createRpcApi(...clientsFor(config));
    return {
      api,
      cluster,
      config,
      demo: DEMO_MODE,
      setCluster: (next: Cluster) => {
        globalThis.localStorage?.setItem(CLUSTER_STORAGE_KEY, next);
        setClusterState(next);
      },
    };
  }, [cluster]);

  return <SealApiContext.Provider value={value}>{children}</SealApiContext.Provider>;
}

function clientsFor(config: ClusterConfig) {
  const { rpc, rpcSubscriptions } = createRpcClients(config);
  return [rpc, rpcSubscriptions] as const;
}

export function useSealApi(): SealApi {
  return useSealContext().api;
}

export function useSealContext(): SealApiContextValue {
  const context = useContext(SealApiContext);
  if (!context) throw new Error('useSealContext must be used inside <SealApiProvider>');
  return context;
}

export function useCluster(): Cluster {
  return useSealContext().cluster;
}
