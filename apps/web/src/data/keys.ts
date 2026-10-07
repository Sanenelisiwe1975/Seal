import type { Address } from '@solana/kit';
import type { Cluster } from '../lib/cluster';

/**
 * Query keys are structured and always carry the cluster, so switching clusters cannot serve a
 * mainnet answer for a devnet question out of the cache.
 */
export const queryKeys = {
  attestation: (cluster: Cluster, address: Address) => [cluster, 'attestation', address] as const,
  attestationsByProgram: (cluster: Cluster, program: Address) =>
    [cluster, 'attestations', 'program', program] as const,
  attestationsByAuditor: (cluster: Cluster, authority: Address) =>
    [cluster, 'attestations', 'auditor', authority] as const,
  auditor: (cluster: Cluster, authority: Address) => [cluster, 'auditor', authority] as const,
  deployState: (cluster: Cluster, program: Address) => [cluster, 'deployState', program] as const,
  statusChanges: (cluster: Cluster, limit: number) => [cluster, 'statusChanges', limit] as const,
  certificate: (cluster: Cluster, asset: Address) => [cluster, 'certificate', asset] as const,
  verifiedBuild: (cluster: Cluster, program: Address) => [cluster, 'verifiedBuild', program] as const,
  onChainVerify: (cluster: Cluster, attestation: Address) => [cluster, 'onChainVerify', attestation] as const,
  preflight: (cluster: Cluster, program: Address, authority: Address) =>
    [cluster, 'preflight', program, authority] as const,
};

/** How long each kind of answer stays fresh. Deploy state is short because a subscription corrects it. */
export const staleTimes = {
  attestation: 30_000,
  auditor: 60_000,
  deployState: 10_000,
  statusChanges: 15_000,
  certificate: 60_000,
  verifiedBuild: 300_000,
  onChainVerify: 0,
  preflight: 0,
};
