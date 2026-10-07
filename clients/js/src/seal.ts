// Hand-written helpers on top of the Codama-generated client (src/generated).
// The generated code is never edited; anything Seal-specific lives here.
import {
  appendTransactionMessageInstruction,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getProgramDerivedAddress,
  getAddressEncoder,
  getAddressDecoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type GetAccountInfoApi,
  type GetLatestBlockhashApi,
  type Rpc,
  type SimulateTransactionApi,
} from '@solana/kit';
import {
  AttestationStatus,
  fetchAttestation,
  fetchMaybeAttestation,
  fetchMaybeAuditor,
  findAttestationPda,
  findAuditorPda,
  getAttestationStatusDecoder,
  getVerifyInstruction,
  type Attestation,
} from './generated/index.ts';
import {
  fetchVerifiedBuild,
  type FetchVerifiedBuildOptions,
  type VerifiedBuild,
} from './verifiedBuild.ts';

export const BPF_LOADER_UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111' as Address;

/** Loader-v3 ProgramData address of an upgradeable program. */
export async function findProgramDataAddress(program: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: BPF_LOADER_UPGRADEABLE,
    seeds: [getAddressEncoder().encode(program)],
  });
  return pda;
}

export type DeployState = { slot: bigint; upgradeAuthority: Address | null };

/** Parse a ProgramData header: u32 tag (3) | u64 slot | Option<Pubkey>. Mirrors loader.rs. */
export function parseProgramDataHeader(data: Uint8Array): DeployState | null {
  if (data.length < 45) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== 3) return null;
  const slot = view.getBigUint64(4, true);
  const tag = data[12];
  if (tag === 0) return { slot, upgradeAuthority: null };
  if (tag === 1) return { slot, upgradeAuthority: getAddressDecoder().decode(data.subarray(13, 45)) };
  return null;
}

/**
 * Live deploy state of a program, or null if it is closed / not loader-v3.
 * The CLI uses `slot` as `expectedDeploySlot` when issuing.
 */
export async function fetchDeployState(
  rpc: Rpc<GetAccountInfoApi>,
  program: Address,
): Promise<DeployState | null> {
  const pd = await findProgramDataAddress(program);
  // Only the 45-byte header is needed; skip downloading the ELF.
  const { value } = await rpc
    .getAccountInfo(pd, { encoding: 'base64', dataSlice: { offset: 0, length: 45 } })
    .send();
  if (!value || value.owner !== BPF_LOADER_UPGRADEABLE) return null;
  return parseProgramDataHeader(new Uint8Array(getBase64Encoder().encode(value.data[0])));
}

/** Same rules as `loader::evaluate` on-chain (ARCHITECTURE.md §6), for UIs and the watcher. */
export function evaluateStatus(
  att: Pick<Attestation, 'status' | 'deploySlot' | 'expiresAt'>,
  live: DeployState | null,
  nowUnix: bigint,
): AttestationStatus {
  if (att.status === AttestationStatus.Revoked) return AttestationStatus.Revoked;
  if (!live) return AttestationStatus.ProgramClosed;
  if (live.slot !== att.deploySlot) return AttestationStatus.Stale;
  if (att.expiresAt !== 0n && nowUnix >= att.expiresAt) return AttestationStatus.Expired;
  return AttestationStatus.Valid;
}

/**
 * Ask the program itself: simulate `verify` and decode its return data.
 * No signature and no fees: the fee payer is a no-op signer and sigVerify is off.
 */
export async function simulateVerify(
  rpc: Rpc<GetAccountInfoApi & GetLatestBlockhashApi & SimulateTransactionApi>,
  attestation: Address,
  feePayer: Address,
): Promise<AttestationStatus> {
  const att = await fetchAttestation(rpc, attestation);
  const ix = getVerifyInstruction({ attestation, targetProgramdata: att.data.programdata });
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(createNoopSigner(feePayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(ix, m),
  );
  const wire = getBase64EncodedWireTransaction(compileTransaction(message));
  const { value } = await rpc
    .simulateTransaction(wire, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true })
    .send();
  if (value.err) throw new Error(`verify simulation failed: ${JSON.stringify(value.err)}\n${value.logs?.join('\n')}`);
  if (!value.returnData) throw new Error('verify returned no data');
  return getAttestationStatusDecoder().decode(getBase64Encoder().encode(value.returnData.data[0]));
}

/**
 * Parse a loader-v3 `Program` account header: u32 tag (2) | Pubkey programdata_address.
 * Mirrors the on-chain check that rejects a spoofed ProgramData account.
 */
export function parseProgramHeader(data: Uint8Array): Address | null {
  if (data.length < 36) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== 2) return null;
  return getAddressDecoder().decode(data.subarray(4, 36));
}

export type PreflightCheckId = 'loader' | 'programdata' | 'auditor' | 'attestation' | 'verifiedBuild';

export type PreflightCheck = {
  id: PreflightCheckId;
  label: string;
  passed: boolean;
  detail: string;
  /**
   * A failed check the auditor may knowingly proceed past. Only the verified-build link is
   * overridable: the rest are conditions `issue_attestation` itself enforces, so overriding them
   * would only produce a failed transaction.
   */
  overridable: boolean;
};

export type PreflightResult = {
  checks: PreflightCheck[];
  /** Every non-overridable check passed, so the transaction is expected to land. */
  ok: boolean;
  /** Live deploy state, i.e. the `expectedDeploySlot` to sign against. */
  deployState: DeployState | null;
  programdata: Address;
  auditorPda: Address;
  attestationPda: Address;
  /** Set when this auditor already attested to this program: the flow must reissue, not issue. */
  existing: Attestation | null;
  verifiedBuild: VerifiedBuild | null;
};

/**
 * Everything `issue_attestation` will check, checked first so the auditor sees why a program
 * cannot be attested instead of a failed simulation. Each returned check maps to one program
 * error: UnsupportedLoader, ProgramDataMismatch / ProgramClosed, AuditorInactive.
 */
export async function preflightIssue(
  rpc: Rpc<GetAccountInfoApi>,
  input: { program: Address; auditorAuthority: Address },
  options: { verifiedBuild?: FetchVerifiedBuildOptions | false } = {},
): Promise<PreflightResult> {
  const { program, auditorAuthority } = input;
  const [programdata, [auditorPda]] = await Promise.all([
    findProgramDataAddress(program),
    findAuditorPda({ authority: auditorAuthority }),
  ]);
  const [attestationPda] = await findAttestationPda({ auditor: auditorPda, targetProgram: program });

  const [programAccount, deployState, auditor, existingAccount, verifiedBuild] = await Promise.all([
    rpc.getAccountInfo(program, { encoding: 'base64', dataSlice: { offset: 0, length: 36 } }).send(),
    fetchDeployState(rpc, program),
    fetchMaybeAuditor(rpc, auditorPda),
    fetchMaybeAttestation(rpc, attestationPda),
    options.verifiedBuild === false
      ? Promise.resolve(null)
      : fetchVerifiedBuild(program, options.verifiedBuild).catch(() => null),
  ]);

  const checks: PreflightCheck[] = [];
  const programValue = programAccount.value;
  const declaredProgramdata = programValue
    ? parseProgramHeader(new Uint8Array(getBase64Encoder().encode(programValue.data[0])))
    : null;

  if (!programValue) {
    checks.push(check('loader', 'Upgradeable program', false, 'No account exists at this address.'));
  } else if (programValue.owner !== BPF_LOADER_UPGRADEABLE) {
    checks.push(
      check('loader', 'Upgradeable program', false, `Owned by ${programValue.owner}, not the BPF Upgradeable Loader.`),
    );
  } else if (declaredProgramdata !== programdata) {
    checks.push(
      check('loader', 'Upgradeable program', false, `Program points at ${declaredProgramdata ?? 'no ProgramData'}, not its loader PDA.`),
    );
  } else {
    checks.push(check('loader', 'Upgradeable program', true, 'Owned by the BPF Upgradeable Loader (loader v3).'));
  }

  checks.push(
    deployState
      ? check('programdata', 'ProgramData readable', true, `Deployed at slot ${deployState.slot}.`)
      : check('programdata', 'ProgramData readable', false, 'ProgramData is closed or not a loader-v3 account.'),
  );

  if (!auditor.exists) {
    checks.push(check('auditor', 'Registered auditor', false, 'This wallet is not a registered Seal auditor.'));
  } else if (!auditor.data.active) {
    checks.push(check('auditor', 'Registered auditor', false, `${auditor.data.name} is suspended and cannot issue.`));
  } else {
    checks.push(check('auditor', 'Registered auditor', true, `${auditor.data.name}, active.`));
  }

  const existing = existingAccount.exists ? existingAccount.data : null;
  checks.push(
    existing
      ? check('attestation', 'No live attestation', false, `Version ${existing.version} already exists; reissue instead.`)
      : check('attestation', 'No live attestation', true, 'This auditor has not attested to this program.'),
  );

  if (options.verifiedBuild !== false) {
    const commit = verifiedBuild?.commit;
    checks.push({
      ...check(
        'verifiedBuild',
        'Verified build',
        verifiedBuild?.verified === true,
        verifiedBuild?.verified === true
          ? `Verified against ${verifiedBuild.repoUrl ?? 'source'}${commit ? ` at ${commit.slice(0, 7)}` : ''}.`
          : 'No OtterSec verified build, so the attestation cannot name an audited commit.',
      ),
      overridable: true,
    });
  }

  return {
    checks,
    ok: checks.every((c) => c.passed || c.overridable),
    deployState,
    programdata,
    auditorPda,
    attestationPda,
    existing,
    verifiedBuild,
  };
}

function check(id: PreflightCheckId, label: string, passed: boolean, detail: string): PreflightCheck {
  return { id, label, passed, detail, overridable: false };
}
