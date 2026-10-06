// Cross-client checks: the Codama-generated TS client must produce and decode exactly
// the bytes the Rust/Anchor side produces (fixtures written by
// programs/seal-registry/tests/fixtures.rs via `npm run fixtures`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { address, createNoopSigner, isSignerRole, isWritableRole, type Address } from '@solana/kit';
import {
  AttestationStatus,
  SEAL_REGISTRY_PROGRAM_ADDRESS,
  findAttestationPda,
  findAuditorPda,
  findConfigPda,
  getAttestationDecoder,
  getAttestationStatusDecoder,
  getIssueAttestationInstruction,
  getIssueAttestationInstructionAsync,
  getRegisterAuditorInstructionDataEncoder,
  getReissueInstructionDataEncoder,
  getRevokeInstructionDataEncoder,
  getSyncStatusInstructionDataEncoder,
  getVerifyInstructionDataEncoder,
  type AttestationParamsArgs,
} from '../../clients/js/src/index.ts';

const fx = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const hex = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b)).toString("hex");
const bytes = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));
const a = (s: string): Address => address(s);

const args: AttestationParamsArgs = {
  expectedDeploySlot: 312_456_789n,
  executableHash: new Uint8Array(32).fill(0xab),
  reportHash: new Uint8Array(32).fill(0xcd),
  reportUri: 'https://umbra.example/reports/demo.pdf',
  findings: { critical: 0, high: 1, medium: 2, low: 3, info: 4 },
  expiresAt: 1_798_761_600n,
};
const certName = 'Seal: demo_counter';
const certUri = 'https://umbra.example/certs/demo.json';

test('program address matches declare_id!', () => {
  assert.equal(SEAL_REGISTRY_PROGRAM_ADDRESS, fx.programId);
});

test('PDA helpers derive the same addresses as Rust', async () => {
  const [config] = await findConfigPda();
  const [auditor] = await findAuditorPda({ authority: a(fx.keys.authority) });
  const [attestation] = await findAttestationPda({ auditor, targetProgram: a(fx.keys.target) });
  assert.equal(config, fx.pdas.config);
  assert.equal(auditor, fx.pdas.auditor);
  assert.equal(attestation, fx.pdas.attestation);
});

test('issue_attestation: same data bytes and same accounts, in order, as Anchor', () => {
  const ix = getIssueAttestationInstruction({
    authority: createNoopSigner(a(fx.keys.authority)),
    config: a(fx.pdas.config),
    auditor: a(fx.pdas.auditor),
    attestation: a(fx.pdas.attestation),
    targetProgram: a(fx.keys.target),
    targetProgramdata: a(fx.pdas.programData),
    asset: createNoopSigner(a(fx.keys.asset)),
    collection: a(fx.keys.collection),
    certOwner: a(fx.keys.owner),
    args,
    certName,
    certUri,
  });
  assert.equal(hex(ix.data!), fx.instructions.issueAttestation.data);
  const ours = ix.accounts!.map((m) => ({
    address: m.address,
    signer: isSignerRole(m.role),
    writable: isWritableRole(m.role),
  }));
  assert.deepEqual(ours, fx.instructions.issueAttestation.accounts);
});

test('issue_attestation async: resolves config, auditor, attestation and ProgramData', async () => {
  // Minimum input: the rest is derived from seeds (including the loader-v3
  // ProgramData PDA added by codama/programdata-default.mjs).
  const ix = await getIssueAttestationInstructionAsync({
    authority: createNoopSigner(a(fx.keys.authority)),
    targetProgram: a(fx.keys.target),
    asset: createNoopSigner(a(fx.keys.asset)),
    collection: a(fx.keys.collection),
    certOwner: a(fx.keys.owner),
    args,
    certName,
    certUri,
  });
  assert.deepEqual(
    ix.accounts.map((m) => m.address),
    fx.instructions.issueAttestation.accounts.map((m: { address: string }) => m.address),
  );
  assert.equal(ix.accounts[5].address, fx.pdas.programData);
});

test('other instructions encode identically', () => {
  assert.equal(hex(getVerifyInstructionDataEncoder().encode({})), fx.instructions.verify.data);
  assert.equal(hex(getSyncStatusInstructionDataEncoder().encode({})), fx.instructions.syncStatus.data);
  assert.equal(hex(getRevokeInstructionDataEncoder().encode({ reason: 3 })), fx.instructions.revoke.data);
  assert.equal(hex(getReissueInstructionDataEncoder().encode({ args })), fx.instructions.reissue.data);
  assert.equal(
    hex(
      getRegisterAuditorInstructionDataEncoder().encode({
        name: 'Umbra Security',
        uri: 'https://umbra.example',
        collectionUri: 'https://umbra.example/collection.json',
      }),
    ),
    fx.instructions.registerAuditor.data,
  );
});

test('Attestation account decodes from the bytes Anchor serializes', () => {
  const att = getAttestationDecoder().decode(bytes(fx.accounts.attestation));
  assert.equal(att.auditor, fx.pdas.auditor);
  assert.equal(att.program, fx.keys.target);
  assert.equal(att.programdata, fx.pdas.programData);
  assert.equal(att.asset, fx.keys.asset);
  assert.equal(att.deploySlot, 312_456_789n);
  assert.equal(hex(att.reportHash), 'cd'.repeat(32));
  assert.equal(att.reportUri, 'https://umbra.example/reports/demo.pdf');
  assert.deepEqual(att.findings, { critical: 0, high: 1, medium: 2, low: 3, info: 4 });
  assert.equal(att.expiresAt, 1_798_761_600n);
  assert.equal(att.status, AttestationStatus.Stale);
  assert.equal(att.version, 2);
  assert.equal(att.bump, 254);
});

test('verify return data decodes to AttestationStatus', () => {
  assert.equal(getAttestationStatusDecoder().decode(bytes(fx.returnData.stale)), AttestationStatus.Stale);
});
