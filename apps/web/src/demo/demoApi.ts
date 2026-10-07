import {
  ATTESTATION_DISCRIMINATOR,
  AttestationStatus,
  evaluateStatus,
  findAttestationPda,
  findAuditorPda,
  findProgramDataAddress,
  type DeployState,
  type PreflightCheck,
  type PreflightResult,
  type VerifiedBuild,
} from '@seal/client';
import { generateKeyPairSigner, type Address } from '@solana/kit';
import type {
  AttestationRecord,
  AuditorRecord,
  Certificate,
  DeployStateListener,
  IssueInput,
  ReissueInput,
  SealApi,
  SignedResult,
  StatusChange,
} from '../data/types';
import { buildDemoRegistry, type DemoRegistry } from './fixtures';

/** Enough delay that loading states are real, not so much that the demo feels slow. */
const LATENCY_MS = 140;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/**
 * In-memory implementation of {@link SealApi} for `VITE_DEMO=1`. It holds mutable deploy state so
 * `simulateUpgrade` can move a program's slot and notify watchers exactly as an `accountNotifications`
 * subscription would, which is what makes the live stale flip demonstrable without a validator.
 */
export function createDemoApi(): SealApi {
  let registry: DemoRegistry | null = null;
  let loading: Promise<DemoRegistry> | null = null;
  const listeners = new Set<{ programs: Set<Address>; onChange: DeployStateListener }>();

  async function load(): Promise<DemoRegistry> {
    if (registry) return registry;
    loading ??= buildDemoRegistry().then((built) => (registry = built));
    return loading;
  }

  function emit(program: Address, state: DeployState | null) {
    for (const listener of listeners) {
      if (listener.programs.has(program)) listener.onChange(program, state);
    }
  }

  function recordChange(reg: DemoRegistry, record: AttestationRecord, from: AttestationStatus | null, to: AttestationStatus) {
    reg.statusChanges.unshift({
      id: `live-${reg.statusChanges.length}-${Date.now()}`,
      attestation: record.address,
      program: record.data.program,
      auditorName: record.auditor.data.name,
      auditorAuthority: record.auditor.data.authority,
      kind: from === null ? 'issued' : 'changed',
      from,
      to,
      at: nowSeconds(),
    });
  }

  return {
    kind: 'demo',

    async getAttestation(address) {
      const reg = await load();
      return delay(reg.attestations.find((a) => a.address === address) ?? null);
    },

    async getAttestationsByProgram(program) {
      const reg = await load();
      return delay(reg.attestations.filter((a) => a.data.program === program));
    },

    async getAttestationsByAuditor(authority) {
      const reg = await load();
      return delay(reg.attestations.filter((a) => a.auditor.data.authority === authority));
    },

    async getAuditorByAuthority(authority) {
      const reg = await load();
      return delay(reg.auditors.find((a) => a.data.authority === authority) ?? null);
    },

    async getDeployState(program) {
      const reg = await load();
      return delay(reg.deployStates.get(program) ?? null);
    },

    watchDeployStates(programs, onChange) {
      const listener = { programs: new Set(programs), onChange };
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async getRecentStatusChanges(limit) {
      const reg = await load();
      return delay([...reg.statusChanges].sort((a, b) => Number(b.at - a.at)).slice(0, limit));
    },

    async getCertificate(asset) {
      const reg = await load();
      return delay(reg.certificates.get(asset) ?? null);
    },

    async getVerifiedBuild(program) {
      const reg = await load();
      const unverified: VerifiedBuild = {
        verified: false,
        repoUrl: null,
        commit: null,
        executableHash: null,
        lastVerifiedAt: null,
      };
      return delay(reg.verifiedBuilds.get(program) ?? unverified);
    },

    async verifyOnChain(address) {
      const reg = await load();
      const record = reg.attestations.find((a) => a.address === address);
      if (!record) throw new Error(`No attestation at ${address}`);
      const live = reg.deployStates.get(record.data.program) ?? null;
      return delay(evaluateStatus(record.data, live, nowSeconds()));
    },

    async preflightIssue(program, auditorAuthority) {
      const reg = await load();
      const live = reg.deployStates.get(program) ?? null;
      const auditorRecord = reg.auditors.find((a) => a.data.authority === auditorAuthority) ?? null;
      const existing = reg.attestations.find(
        (a) => a.data.program === program && a.auditor.data.authority === auditorAuthority,
      );
      const build = reg.verifiedBuilds.get(program) ?? null;
      const known = reg.deployStates.has(program);

      const checks: PreflightCheck[] = [
        pass('loader', 'Upgradeable program', known, known
          ? 'Owned by the BPF Upgradeable Loader (loader v3).'
          : 'No account exists at this address.'),
        pass('programdata', 'ProgramData readable', live !== null, live
          ? `Deployed at slot ${live.slot}.`
          : 'ProgramData is closed or not a loader-v3 account.'),
        pass('auditor', 'Registered auditor', auditorRecord?.data.active === true, auditorRecord
          ? auditorRecord.data.active
            ? `${auditorRecord.data.name}, active.`
            : `${auditorRecord.data.name} is suspended and cannot issue.`
          : 'This wallet is not a registered Seal auditor.'),
        pass('attestation', 'No live attestation', existing === undefined, existing
          ? `Version ${existing.data.version} already exists; reissue instead.`
          : 'This auditor has not attested to this program.'),
        {
          ...pass('verifiedBuild', 'Verified build', build?.verified === true, build?.verified
            ? `Verified against ${build.repoUrl} at ${build.commit?.slice(0, 7)}.`
            : 'No OtterSec verified build, so the attestation cannot name an audited commit.'),
          overridable: true,
        },
      ];

      const auditorPda = auditorRecord?.address ?? (await findAuditorPda({ authority: auditorAuthority }))[0];
      const result: PreflightResult = {
        checks,
        ok: checks.every((c) => c.passed || c.overridable),
        deployState: live,
        programdata: await findProgramDataAddress(program),
        auditorPda,
        attestationPda:
          existing?.address ?? (await findAttestationPda({ auditor: auditorPda, targetProgram: program }))[0],
        existing: existing?.data ?? null,
        verifiedBuild: build,
      };
      return delay(result);
    },

    async issue(input: IssueInput, session): Promise<SignedResult> {
      const reg = await load();
      const live = reg.deployStates.get(input.program);
      if (!live) throw new Error(`Unknown demo program ${input.program}`);
      const auditorRecord = reg.auditors.find((a) => a.data.authority === session.authority);
      if (!auditorRecord) throw new Error('Connected wallet is not a registered auditor');

      const [attestationPda] = await findAttestationPda({
        auditor: auditorRecord.address,
        targetProgram: input.program,
      });
      const asset = (await generateKeyPairSigner()).address;
      const record: AttestationRecord = {
        address: attestationPda,
        auditor: auditorRecord,
        data: {
          discriminator: ATTESTATION_DISCRIMINATOR,
          auditor: auditorRecord.address,
          program: input.program,
          programdata: await findProgramDataAddress(input.program),
          asset,
          deploySlot: input.expectedDeploySlot,
          executableHash: input.executableHash,
          reportHash: input.reportHash,
          reportUri: input.reportUri,
          findings: input.findings,
          issuedAt: nowSeconds(),
          updatedAt: nowSeconds(),
          expiresAt: input.expiresAt,
          status: AttestationStatus.Valid,
          revokeReason: 0,
          version: 1,
          bump: 253,
        },
      };
      reg.attestations.push(record);
      reg.certificates.set(asset, {
        asset,
        owner: live.upgradeAuthority ?? session.authority,
        collection: auditorRecord.data.collection,
        name: input.certName,
        uri: input.certUri,
        frozen: true,
        attributes: [
          { key: 'program', value: input.program },
          { key: 'deploy_slot', value: String(input.expectedDeploySlot) },
          { key: 'status', value: 'valid' },
          { key: 'version', value: '1' },
          { key: 'critical', value: String(input.findings.critical) },
          { key: 'high', value: String(input.findings.high) },
          { key: 'medium', value: String(input.findings.medium) },
          { key: 'low', value: String(input.findings.low) },
        ],
        attributesSource: 'asset',
      });
      auditorRecord.data = {
        ...auditorRecord.data,
        attestationsIssued: auditorRecord.data.attestationsIssued + 1,
      };
      recordChange(reg, record, null, AttestationStatus.Valid);
      return delay({ signature: `demo-issue-${attestationPda.slice(0, 8)}` });
    },

    async reissue(input: ReissueInput): Promise<SignedResult> {
      const reg = await load();
      const record = reg.attestations.find((a) => a.address === input.attestation);
      if (!record) throw new Error(`No attestation at ${input.attestation}`);
      const before = evaluateStatus(record.data, reg.deployStates.get(record.data.program) ?? null, nowSeconds());
      record.data = {
        ...record.data,
        deploySlot: input.expectedDeploySlot,
        reportHash: input.reportHash,
        reportUri: input.reportUri,
        findings: input.findings,
        expiresAt: input.expiresAt,
        status: AttestationStatus.Valid,
        version: record.data.version + 1,
        updatedAt: nowSeconds(),
      };
      recordChange(reg, record, before, AttestationStatus.Valid);
      return delay({ signature: `demo-reissue-${record.address.slice(0, 8)}` });
    },

    async revoke(address, reason): Promise<SignedResult> {
      const reg = await load();
      const record = reg.attestations.find((a) => a.address === address);
      if (!record) throw new Error(`No attestation at ${address}`);
      const before = evaluateStatus(record.data, reg.deployStates.get(record.data.program) ?? null, nowSeconds());
      record.data = { ...record.data, status: AttestationStatus.Revoked, revokeReason: reason, updatedAt: nowSeconds() };
      recordChange(reg, record, before, AttestationStatus.Revoked);
      return delay({ signature: `demo-revoke-${address.slice(0, 8)}` });
    },

    simulateUpgrade(program) {
      void (async () => {
        const reg = await load();
        const current = reg.deployStates.get(program);
        if (!current) return;
        const next: DeployState = { ...current, slot: current.slot + 1_447n };
        reg.deployStates.set(program, next);
        for (const record of reg.attestations.filter((a) => a.data.program === program)) {
          const after = evaluateStatus(record.data, next, nowSeconds());
          if (after !== evaluateStatus(record.data, current, nowSeconds())) {
            recordChange(reg, record, evaluateStatus(record.data, current, nowSeconds()), after);
          }
        }
        emit(program, next);
      })();
    },
  };
}

function pass(
  id: PreflightCheck['id'],
  label: string,
  passed: boolean,
  detail: string,
): PreflightCheck {
  return { id, label, passed, detail, overridable: false };
}
