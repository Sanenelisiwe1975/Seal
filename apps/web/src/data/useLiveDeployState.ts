import type { DeployState } from '@seal/client';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { Address } from '@solana/kit';
import { useCluster, useSealApi } from './SealApiProvider';
import { queryKeys, staleTimes } from './keys';

export type LiveDeployState = {
  /** Live deploy state per program; a present key with `null` means the ProgramData is gone. */
  states: Map<Address, DeployState | null>;
  /** Wall-clock time a program's deploy state last changed while this page was open. */
  changedAt: Map<Address, number>;
  isLoading: boolean;
  error: Error | null;
};

/**
 * The one place the UI learns about deploy state, initially by reading each ProgramData account and
 * then by subscribing to it. Pushed updates are written straight into the query cache, so every
 * component reading a deploy state re-renders from one source.
 *
 * Replacing RPC `accountNotifications` with a Geyser-backed watcher means changing
 * `SealApi.watchDeployStates` only: nothing in this hook or above it moves.
 */
export function useLiveDeployState(programs: Address[]): LiveDeployState {
  const api = useSealApi();
  const cluster = useCluster();
  const queryClient = useQueryClient();
  const [changedAt, setChangedAt] = useState<Map<Address, number>>(new Map());

  // A stable identity for the watched set, so the subscription is not torn down on every render.
  const watched = useMemo(() => [...new Set(programs)].sort(), [programs.join('\u0000')]);

  const results = useQueries({
    queries: watched.map((program) => ({
      queryKey: queryKeys.deployState(cluster, program),
      queryFn: () => api.getDeployState(program),
      staleTime: staleTimes.deployState,
    })),
  });

  useEffect(() => {
    if (watched.length === 0) return;
    return api.watchDeployStates(watched, (program, state) => {
      const key = queryKeys.deployState(cluster, program);
      const previous = queryClient.getQueryData<DeployState | null>(key);
      if (previous?.slot === state?.slot && previous?.upgradeAuthority === state?.upgradeAuthority) return;
      queryClient.setQueryData(key, state);
      setChangedAt((current) => new Map(current).set(program, Date.now()));
    });
  }, [api, cluster, queryClient, watched]);

  const states = new Map<Address, DeployState | null>();
  watched.forEach((program, index) => {
    const result = results[index];
    if (result && !result.isPending) states.set(program, result.data ?? null);
  });

  return {
    states,
    changedAt,
    isLoading: results.some((result) => result.isPending),
    error: (results.find((result) => result.error)?.error as Error | undefined) ?? null,
  };
}
