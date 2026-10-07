import type { Attestation, AttestationStatus } from '@seal/client';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { Address } from '@solana/kit';
import { useCluster, useSealApi } from './SealApiProvider';
import { queryKeys, staleTimes } from './keys';
import type {
  AttestationRecord,
  AuditorRecord,
  AuditorSession,
  Certificate,
  IssueInput,
  ReissueInput,
  StatusChange,
} from './types';

export function useAttestation(address: Address | null): UseQueryResult<AttestationRecord | null> {
  const api = useSealApi();
  const cluster = useCluster();
  return useQuery({
    queryKey: queryKeys.attestation(cluster, address ?? ('' as Address)),
    queryFn: () => api.getAttestation(address as Address),
    enabled: address !== null,
    staleTime: staleTimes.attestation,
  });
}

export function useProgramAttestations(program: Address | null): UseQueryResult<AttestationRecord[]> {
  const api = useSealApi();
  const cluster = useCluster();
  return useQuery({
    queryKey: queryKeys.attestationsByProgram(cluster, program ?? ('' as Address)),
    queryFn: () => api.getAttestationsByProgram(program as Address),
    enabled: program !== null,
    staleTime: staleTimes.attestation,
  });
}

export function useAuditorAttestations(authority: Address | null): UseQueryResult<AttestationRecord[]> {
  const api = useSealApi();
  const cluster = useCluster();
  return useQuery({
    queryKey: queryKeys.attestationsByAuditor(cluster, authority ?? ('' as Address)),
    queryFn: () => api.getAttestationsByAuditor(authority as Address),
    enabled: authority !== null,
    staleTime: staleTimes.attestation,
  });
}

export function useAuditor(authority: Address | null): UseQueryResult<AuditorRecord | null> {
  const api = useSealApi();
  const cluster = useCluster();
  return useQuery({
    queryKey: queryKeys.auditor(cluster, authority ?? ('' as Address)),
    queryFn: () => api.getAuditorByAuthority(authority as Address),
    enabled: authority !== null,
    staleTime: staleTimes.auditor,
  });
}

export function useStatusChanges(limit = 12): UseQueryResult<StatusChange[]> {
  const api = useSealApi();
  const cluster = useCluster();
  return useQuery({
    queryKey: queryKeys.statusChanges(cluster, limit),
    queryFn: () => api.getRecentStatusChanges(limit),
    staleTime: staleTimes.statusChanges,
  });
}

export function useCertificate(
  asset: Address | null,
  attestation: Attestation | null,
): UseQueryResult<Certificate | null> {
  const api = useSealApi();
  const cluster = useCluster();
  return useQuery({
    queryKey: queryKeys.certificate(cluster, asset ?? ('' as Address)),
    queryFn: () => api.getCertificate(asset as Address, attestation as Attestation),
    enabled: asset !== null && attestation !== null,
    staleTime: staleTimes.certificate,
  });
}

export function useVerifiedBuild(program: Address | null) {
  const api = useSealApi();
  const cluster = useCluster();
  return useQuery({
    queryKey: queryKeys.verifiedBuild(cluster, program ?? ('' as Address)),
    queryFn: () => api.getVerifiedBuild(program as Address),
    enabled: program !== null,
    staleTime: staleTimes.verifiedBuild,
  });
}

/** Asks the program itself. Never runs on its own: the detail page triggers it explicitly. */
export function useOnChainVerify(attestation: Address, feePayer: Address) {
  const api = useSealApi();
  const cluster = useCluster();
  return useQuery<AttestationStatus>({
    queryKey: queryKeys.onChainVerify(cluster, attestation),
    queryFn: () => api.verifyOnChain(attestation, feePayer),
    enabled: false,
    staleTime: staleTimes.onChainVerify,
    retry: false,
  });
}

export function usePreflightIssue(program: Address | null, authority: Address | null) {
  const api = useSealApi();
  const cluster = useCluster();
  return useQuery({
    queryKey: queryKeys.preflight(cluster, program ?? ('' as Address), authority ?? ('' as Address)),
    queryFn: () => api.preflightIssue(program as Address, authority as Address),
    enabled: program !== null && authority !== null,
    staleTime: staleTimes.preflight,
    retry: false,
  });
}

function useRegistryInvalidation() {
  const queryClient = useQueryClient();
  const cluster = useCluster();
  return (program: Address, attestation?: Address) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.attestationsByProgram(cluster, program) });
    void queryClient.invalidateQueries({ queryKey: [cluster, 'statusChanges'] });
    void queryClient.invalidateQueries({ queryKey: [cluster, 'attestations', 'auditor'] });
    if (attestation) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.attestation(cluster, attestation) });
    }
  };
}

export function useIssueAttestation(session: AuditorSession | null) {
  const api = useSealApi();
  const invalidate = useRegistryInvalidation();
  return useMutation({
    mutationFn: (input: IssueInput) => {
      if (!session) throw new Error('Connect an auditor wallet first.');
      return api.issue(input, session);
    },
    onSuccess: (_result, input) => invalidate(input.program),
  });
}

export function useReissueAttestation(session: AuditorSession | null) {
  const api = useSealApi();
  const invalidate = useRegistryInvalidation();
  return useMutation({
    mutationFn: (input: ReissueInput) => {
      if (!session) throw new Error('Connect an auditor wallet first.');
      return api.reissue(input, session);
    },
    onSuccess: (_result, input) => invalidate(input.program, input.attestation),
  });
}

export function useRevokeAttestation(session: AuditorSession | null, record: AttestationRecord | null) {
  const api = useSealApi();
  const invalidate = useRegistryInvalidation();
  return useMutation({
    mutationFn: (reason: number) => {
      if (!session || !record) throw new Error('Connect the issuing auditor wallet first.');
      return api.revoke(record.address, reason, session);
    },
    onSuccess: () => {
      if (record) invalidate(record.data.program, record.address);
    },
  });
}
