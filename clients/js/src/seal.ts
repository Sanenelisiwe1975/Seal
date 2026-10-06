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
  getAttestationStatusDecoder,
  getVerifyInstruction,
  type Attestation,
} from './generated/index.ts';

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
