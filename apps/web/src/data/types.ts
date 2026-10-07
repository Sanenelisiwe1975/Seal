import type {
  Attestation,
  AttestationStatus,
  Auditor,
  DeployState,
  Findings,
  PreflightResult,
  VerifiedBuild,
} from '@seal/client';
import type { Address, TransactionSendingSigner } from '@solana/kit';

/** An attestation together with the auditor that issued it: the unit every screen renders. */
export type AttestationRecord = {
  address: Address;
  data: Attestation;
  auditor: AuditorRecord;
};

export type AuditorRecord = {
  /** The Auditor PDA. */
  address: Address;
  data: Auditor;
};

/** One status change in the registry, newest first in the feed. */
export type StatusChange = {
  id: string;
  attestation: Address;
  program: Address;
  auditorName: string;
  auditorAuthority: Address;
  /** An issuance has no prior status; a change may have one the data source could not recover. */
  kind: 'issued' | 'changed';
  from: AttestationStatus | null;
  to: AttestationStatus;
  at: bigint;
};

/**
 * The Metaplex Core certificate behind an attestation.
 *
 * `attributesSource` says where the attribute values came from, because the two can legitimately
 * disagree: the on-chain Attributes plugin is a cache that only moves when `sync_status` runs.
 * The UI must never present registry-derived values as if they were read off the asset.
 */
export type Certificate = {
  asset: Address;
  owner: Address;
  /** The auditor's collection, from the asset's update authority. */
  collection: Address | null;
  name: string;
  uri: string;
  /**
   * `PermanentFreezeDelegate { frozen: true }` with no authority: soulbound.
   * `null` when the plugin registry was not read, which the UI states rather than assuming.
   */
  frozen: boolean | null;
  attributes: { key: string; value: string }[];
  attributesSource: 'asset' | 'registry';
};

export type IssueInput = {
  program: Address;
  expectedDeploySlot: bigint;
  executableHash: Uint8Array;
  reportHash: Uint8Array;
  reportUri: string;
  findings: Findings;
  expiresAt: bigint;
  certName: string;
  certUri: string;
};

export type ReissueInput = Omit<IssueInput, 'certName' | 'certUri'> & { attestation: Address };

export type SignedResult = { signature: string };

/**
 * The auditor doing the writing. `signer` comes from the connected Wallet Standard account; demo
 * mode supplies an authority with no signer and never touches the network.
 */
export type AuditorSession = {
  authority: Address;
  signer: TransactionSendingSigner | null;
};

/** Called with the live deploy state every time a watched ProgramData account changes. */
export type DeployStateListener = (program: Address, state: DeployState | null) => void;

/**
 * Everything the UI needs from the chain, in one place. Two implementations exist: one backed by
 * RPC and the generated client, one by in-memory fixtures for demo mode. Components only ever see
 * the hooks built on top of this, so neither implementation leaks into a component.
 */
export type SealApi = {
  readonly kind: 'rpc' | 'demo';

  getAttestation(address: Address): Promise<AttestationRecord | null>;
  getAttestationsByProgram(program: Address): Promise<AttestationRecord[]>;
  getAttestationsByAuditor(authority: Address): Promise<AttestationRecord[]>;
  getAuditorByAuthority(authority: Address): Promise<AuditorRecord | null>;

  getDeployState(program: Address): Promise<DeployState | null>;
  /** Subscribes to the ProgramData accounts of the given programs. Returns an unsubscribe function. */
  watchDeployStates(programs: Address[], onChange: DeployStateListener): () => void;

  getRecentStatusChanges(limit: number): Promise<StatusChange[]>;
  /** The attestation is passed so the implementation can label registry-derived attributes honestly. */
  getCertificate(asset: Address, attestation: Attestation): Promise<Certificate | null>;
  getVerifiedBuild(program: Address): Promise<VerifiedBuild>;

  /** Asks the program itself, by simulating `verify`. */
  verifyOnChain(attestation: Address, feePayer: Address): Promise<AttestationStatus>;
  preflightIssue(program: Address, auditorAuthority: Address): Promise<PreflightResult>;

  issue(input: IssueInput, session: AuditorSession): Promise<SignedResult>;
  reissue(input: ReissueInput, session: AuditorSession): Promise<SignedResult>;
  revoke(attestation: Address, reason: number, session: AuditorSession): Promise<SignedResult>;

  /** Demo mode only: moves a program's deploy slot so the live stale flip can be shown. */
  simulateUpgrade?(program: Address): void;
};
