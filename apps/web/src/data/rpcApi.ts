import {
  ATTESTATION_DISCRIMINATOR,
  SEAL_REGISTRY_PROGRAM_ADDRESS,
  evaluateStatus,
  fetchMaybeAttestation,
  fetchMaybeAuditor,
  findAttestationPda,
  findAuditorPda,
  findProgramDataAddress,
  getAttestationDecoder,
  getIssueAttestationInstructionAsync,
  getReissueInstructionAsync,
  getRevokeInstructionAsync,
  fetchVerifiedBuild,
  parseProgramDataHeader,
  preflightIssue,
  simulateVerify,
  type Attestation,
  type DeployState,
} from '@seal/client';
import {
  appendTransactionMessageInstruction,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase58Decoder,
  getBase64Encoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
  type Address,
  type Base58EncodedBytes,
  type GetProgramAccountsMemcmpFilter,
  type Instruction,
  type TransactionSendingSigner,
} from '@solana/kit';
import type { SealRpc, SealRpcSubscriptions } from './rpcClient';
import type {
  AttestationRecord,
  AuditorRecord,
  AuditorSession,
  Certificate,
  DeployStateListener,
  IssueInput,
  ReissueInput,
  SealApi,
  SignedResult,
  StatusChange,
} from './types';
import { decodeCoreAssetHeader, registryAttributes } from './coreAsset';
import { decorateProgramError } from '../lib/errors';

/** Byte offsets into the Attestation account, used for server-side `getProgramAccounts` filters. */
const OFFSET_AUDITOR = 8;
const OFFSET_PROGRAM = 40;

export function createRpcApi(rpc: SealRpc, rpcSubscriptions: SealRpcSubscriptions): SealApi {
  const auditorCache = new Map<Address, AuditorRecord | null>();

  async function auditorByPda(pda: Address): Promise<AuditorRecord | null> {
    const cached = auditorCache.get(pda);
    if (cached !== undefined) return cached;
    const account = await fetchMaybeAuditor(rpc, pda);
    const record = account.exists ? { address: pda, data: account.data } : null;
    auditorCache.set(pda, record);
    return record;
  }

  async function withAuditors(
    accounts: { address: Address; data: Attestation }[],
  ): Promise<AttestationRecord[]> {
    const auditors = await Promise.all([...new Set(accounts.map((a) => a.data.auditor))].map(auditorByPda));
    const byPda = new Map(auditors.filter((a): a is AuditorRecord => a !== null).map((a) => [a.address, a]));
    return accounts.flatMap((account) => {
      const auditor = byPda.get(account.data.auditor);
      return auditor ? [{ ...account, auditor }] : [];
    });
  }

  async function attestationsWhere(offset: number, value: Address): Promise<AttestationRecord[]> {
    const { value: accounts } = await rpc
      .getProgramAccounts(SEAL_REGISTRY_PROGRAM_ADDRESS, {
        encoding: 'base64',
        withContext: true,
        filters: [discriminatorFilter(), { memcmp: { offset: BigInt(offset), bytes: base58(value), encoding: 'base58' } }],
      })
      .send();
    const decoded = accounts.map(({ pubkey, account }) => ({
      address: pubkey,
      data: getAttestationDecoder().decode(getBase64Encoder().encode(account.data[0])),
    }));
    return withAuditors(decoded);
  }

  async function sendInstruction(instruction: Instruction, signer: TransactionSendingSigner): Promise<SignedResult> {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstruction(instruction, m),
    );
    try {
      const signature = await signAndSendTransactionMessageWithSigners(message);
      return { signature: getBase58Decoder().decode(signature) };
    } catch (error) {
      // The message is in hand here, so a Seal error can be decoded to its real meaning.
      throw decorateProgramError(error, message);
    }
  }

  function requireSigner(session: AuditorSession): TransactionSendingSigner {
    if (!session.signer) throw new Error('Connect an auditor wallet to sign this transaction.');
    return session.signer;
  }

  async function loadForWrite(attestation: Address) {
    const account = await fetchMaybeAttestation(rpc, attestation);
    if (!account.exists) throw new Error(`No attestation at ${attestation}`);
    const auditor = await auditorByPda(account.data.auditor);
    if (!auditor) throw new Error('Issuing auditor account is missing');
    return { data: account.data, auditor };
  }

  return {
    kind: 'rpc',

    async getAttestation(address) {
      const account = await fetchMaybeAttestation(rpc, address);
      if (!account.exists) return null;
      const [record] = await withAuditors([{ address, data: account.data }]);
      return record ?? null;
    },

    getAttestationsByProgram(program) {
      return attestationsWhere(OFFSET_PROGRAM, program);
    },

    async getAttestationsByAuditor(authority) {
      const [auditorPda] = await findAuditorPda({ authority });
      return attestationsWhere(OFFSET_AUDITOR, auditorPda);
    },

    async getAuditorByAuthority(authority) {
      const [auditorPda] = await findAuditorPda({ authority });
      auditorCache.delete(auditorPda);
      return auditorByPda(auditorPda);
    },

    getDeployState(program) {
      return fetchDeployStateVia(rpc, program);
    },

    watchDeployStates(programs, onChange) {
      const controller = new AbortController();
      for (const program of programs) {
        void subscribeToProgramData(rpc, rpcSubscriptions, program, onChange, controller.signal);
      }
      return () => controller.abort();
    },

    async getRecentStatusChanges(limit) {
      const { value: accounts } = await rpc
        .getProgramAccounts(SEAL_REGISTRY_PROGRAM_ADDRESS, {
          encoding: 'base64',
          withContext: true,
          filters: [discriminatorFilter()],
        })
        .send();
      const decoded = accounts.map(({ pubkey, account }) => ({
        address: pubkey,
        data: getAttestationDecoder().decode(getBase64Encoder().encode(account.data[0])),
      }));
      const records = await withAuditors(decoded);
      return records
        .sort((a, b) => Number(b.data.updatedAt - a.data.updatedAt))
        .slice(0, limit)
        .map(
          (record): StatusChange => ({
            id: `${record.address}-${record.data.updatedAt}`,
            attestation: record.address,
            program: record.data.program,
            auditorName: record.auditor.data.name,
            auditorAuthority: record.auditor.data.authority,
            kind: record.data.updatedAt === record.data.issuedAt ? 'issued' : 'changed',
            from: null,
            to: record.data.status,
            at: record.data.updatedAt,
          }),
        );
    },

    async getCertificate(asset, attestation) {
      const { value } = await rpc.getAccountInfo(asset, { encoding: 'base64' }).send();
      if (!value) return null;
      const header = decodeCoreAssetHeader(new Uint8Array(getBase64Encoder().encode(value.data[0])));
      if (!header) return null;
      return {
        asset,
        owner: header.owner,
        collection: header.collection,
        name: header.name,
        uri: header.uri,
        // The plugin registry is not decoded here, so freeze state is unknown rather than assumed.
        frozen: null,
        attributes: registryAttributes(attestation),
        attributesSource: 'registry',
      } satisfies Certificate;
    },

    getVerifiedBuild(program) {
      return fetchVerifiedBuild(program);
    },

    verifyOnChain(attestation, feePayer) {
      return simulateVerify(rpc, attestation, feePayer);
    },

    preflightIssue(program, auditorAuthority) {
      return preflightIssue(rpc, { program, auditorAuthority });
    },

    async issue(input: IssueInput, session): Promise<SignedResult> {
      const signer = requireSigner(session);
      const [auditorPda] = await findAuditorPda({ authority: session.authority });
      const auditor = await auditorByPda(auditorPda);
      if (!auditor) throw new Error('This wallet is not a registered Seal auditor.');
      const live = await fetchDeployStateVia(rpc, input.program);
      if (!live) throw new Error('The program has no readable ProgramData account.');
      const asset = await generateKeyPairSigner();
      const instruction = await getIssueAttestationInstructionAsync({
        authority: signer,
        targetProgram: input.program,
        asset,
        collection: auditor.data.collection,
        certOwner: live.upgradeAuthority ?? session.authority,
        args: {
          expectedDeploySlot: input.expectedDeploySlot,
          executableHash: input.executableHash,
          reportHash: input.reportHash,
          reportUri: input.reportUri,
          findings: input.findings,
          expiresAt: input.expiresAt,
        },
        certName: input.certName,
        certUri: input.certUri,
      });
      return sendInstruction(instruction, signer);
    },

    async reissue(input: ReissueInput, session): Promise<SignedResult> {
      const signer = requireSigner(session);
      const { data, auditor } = await loadForWrite(input.attestation);
      const instruction = await getReissueInstructionAsync({
        authority: signer,
        auditor: auditor.address,
        attestation: input.attestation,
        targetProgramdata: data.programdata,
        asset: data.asset,
        collection: auditor.data.collection,
        args: {
          expectedDeploySlot: input.expectedDeploySlot,
          executableHash: input.executableHash,
          reportHash: input.reportHash,
          reportUri: input.reportUri,
          findings: input.findings,
          expiresAt: input.expiresAt,
        },
      });
      return sendInstruction(instruction, signer);
    },

    async revoke(attestation, reason, session): Promise<SignedResult> {
      const signer = requireSigner(session);
      const { data, auditor } = await loadForWrite(attestation);
      const instruction = await getRevokeInstructionAsync({
        authority: signer,
        auditor: auditor.address,
        attestation,
        asset: data.asset,
        collection: auditor.data.collection,
        reason,
      });
      return sendInstruction(instruction, signer);
    },
  };
}

/** `fetchDeployState` from the client, typed against this app's RPC shape. */
async function fetchDeployStateVia(rpc: SealRpc, program: Address): Promise<DeployState | null> {
  const programdata = await findProgramDataAddress(program);
  const { value } = await rpc
    .getAccountInfo(programdata, { encoding: 'base64', dataSlice: { offset: 0, length: 45 } })
    .send();
  if (!value) return null;
  return parseProgramDataHeader(new Uint8Array(getBase64Encoder().encode(value.data[0])));
}

/**
 * One `accountNotifications` subscription per watched ProgramData account. A Geyser-backed watcher
 * can replace this function without touching the hook above it.
 */
async function subscribeToProgramData(
  rpc: SealRpc,
  rpcSubscriptions: SealRpcSubscriptions,
  program: Address,
  onChange: DeployStateListener,
  abortSignal: AbortSignal,
): Promise<void> {
  const programdata = await findProgramDataAddress(program);
  if (abortSignal.aborted) return;
  const notifications = await rpcSubscriptions
    .accountNotifications(programdata, { encoding: 'base64' })
    .subscribe({ abortSignal });
  for await (const notification of notifications) {
    const data = notification.value?.data?.[0];
    onChange(program, data ? parseProgramDataHeader(new Uint8Array(getBase64Encoder().encode(data))) : null);
  }
}

function discriminatorFilter(): GetProgramAccountsMemcmpFilter {
  return {
    memcmp: { offset: 0n, bytes: base58(getBase58Decoder().decode(ATTESTATION_DISCRIMINATOR)), encoding: 'base58' },
  };
}

/** `Base58EncodedBytes` is a branded string; an address and a base58 decode are both already one. */
function base58(value: string): Base58EncodedBytes {
  return value as Base58EncodedBytes;
}
