import {
  ATTESTATION_DISCRIMINATOR,
  AUDITOR_DISCRIMINATOR,
  AttestationStatus,
  findProgramDataAddress,
  getAttestationDecoder,
  type Attestation,
  type Auditor,
  type DeployState,
  type Findings,
  type VerifiedBuild,
} from '@seal/client';
import { getBase16Encoder, type Address } from '@solana/kit';
import fixtures from '../../../../tests/client/fixtures.json';
import type { AttestationRecord, AuditorRecord, Certificate, StatusChange } from '../data/types';

/**
 * The demo registry. The `demo_counter` row is the real fixture the client tests assert against,
 * decoded here with the generated decoder; the rest is synthetic data around it so the registry has
 * every status, an immutable program and a program with two independent auditors.
 */
export type DemoRegistry = {
  auditors: AuditorRecord[];
  attestations: AttestationRecord[];
  deployStates: Map<Address, DeployState | null>;
  certificates: Map<Address, Certificate>;
  verifiedBuilds: Map<Address, VerifiedBuild>;
  statusChanges: StatusChange[];
  programNames: Map<Address, string>;
};

const PROGRAMS = {
  swap: '63u2RfUU5Fn3pfJdsi4S3kmpkdJvs6jjTVskAFHCUZVB' as Address,
  vault: '5ajGoAVtCr1UknHQtP14AM1KJc3RyXfbFa4EAA7PMc5P' as Address,
  amm: 'GzEq3uWqSTsGckqFZQw6xsVZRbengu7VZg67n8MTpJVJ' as Address,
  lend: '5Kkk4EnSQxycBSgH7e1nkLW9q44taUU9rdCp5UPGMjfV' as Address,
  oracle: 'Cy8aqwbUttZ6gfziwZY4be8gskPfEqz13tJYeTcu7a8o' as Address,
  closed: '3bp81gcTgAEr9xoyD7Jz4dBGUkovBLgevVhBYHgZbRsX' as Address,
  counter: fixtures.keys.target as Address,
};

const AUTHORITIES = {
  umbra: fixtures.keys.authority as Address,
  osec: '4dWsbQC4DYy6zPaTEN7gGxERBFANUEmUFx8jzN5i2Au9' as Address,
  zellic: '7dPRdNirtLE267nXHAAQexJo7QPogxSJV5iSzcd6hbUL' as Address,
};

const AUDITOR_PDAS = {
  umbra: fixtures.pdas.auditor as Address,
  osec: 'B9Er97SakULCzA16F2EbWnrViGWTX54CYJSqzzQ9H37z' as Address,
  zellic: 'B4AHkYKBVXnEs2w6yuKxKNdYYEYUd2cKy38DXGKsJayu' as Address,
};

const COLLECTIONS = {
  umbra: fixtures.keys.collection as Address,
  osec: '91QvfjSNUmX51k5d7DsR2hoqfTrqUdpvJgpX7ktKegNH' as Address,
  zellic: '3QfKkKuAJU43QrKc8ddUeghNcrpj66TycKiE8XA5ZB5A' as Address,
};

const OWNERS = {
  swap: 'HkzMjEXraDb2rTMExDgJLkMm78DrjS6Mp2spDWZRTLa6' as Address,
  vault: '7b5Ub78XzEVCFuSByQQRVnPi5eX1y14qMjUqvJmchVxV' as Address,
  other: 'CmBZcdWHrUes5ofgwZgahPh5hUJreEuwCJ5yS4sW4Nc2' as Address,
};

const HOUR = 3600;
const DAY = 86_400;

function findings(critical: number, high: number, medium: number, low: number, info: number): Findings {
  return { critical, high, medium, low, info };
}

function hash(seed: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 7) % 256);
}

function auditor(
  address: Address,
  authority: Address,
  collection: Address,
  name: string,
  uri: string,
  active: boolean,
  attestationsIssued: number,
): AuditorRecord {
  return {
    address,
    data: { discriminator: AUDITOR_DISCRIMINATOR, authority, collection, name, uri, active, attestationsIssued, bump: 254 },
  };
}

type AttestationSeed = {
  address: Address;
  auditor: AuditorRecord;
  program: Address;
  asset: Address;
  deploySlot: bigint;
  status: AttestationStatus;
  version: number;
  findings: Findings;
  reportUri: string;
  issuedAgo: number;
  updatedAgo: number;
  expiresAt: bigint;
  revokeReason?: number;
};

async function attestation(seed: AttestationSeed, now: number): Promise<AttestationRecord> {
  const data: Attestation = {
    discriminator: ATTESTATION_DISCRIMINATOR,
    auditor: seed.auditor.address,
    program: seed.program,
    programdata: await findProgramDataAddress(seed.program),
    asset: seed.asset,
    deploySlot: seed.deploySlot,
    executableHash: hash(seed.version + seed.program.length),
    reportHash: hash(seed.version * 3 + 11),
    reportUri: seed.reportUri,
    findings: seed.findings,
    issuedAt: BigInt(now - seed.issuedAgo),
    updatedAt: BigInt(now - seed.updatedAgo),
    expiresAt: seed.expiresAt,
    status: seed.status,
    revokeReason: seed.revokeReason ?? 0,
    version: seed.version,
    bump: 253,
  };
  return { address: seed.address, data, auditor: seed.auditor };
}

function certificate(record: AttestationRecord, owner: Address, frozen = true): Certificate {
  const { data } = record;
  return {
    asset: data.asset,
    owner,
    collection: record.auditor.data.collection,
    name: `Seal: ${data.program.slice(0, 4)}`,
    uri: `${record.auditor.data.uri}/certs/${data.program.slice(0, 8)}.json`,
    frozen,
    attributes: [
      { key: 'program', value: data.program },
      { key: 'deploy_slot', value: String(data.deploySlot) },
      { key: 'status', value: AttestationStatus[data.status].toLowerCase() },
      { key: 'version', value: String(data.version) },
      { key: 'critical', value: String(data.findings.critical) },
      { key: 'high', value: String(data.findings.high) },
      { key: 'medium', value: String(data.findings.medium) },
      { key: 'low', value: String(data.findings.low) },
      { key: 'report_hash', value: [...data.reportHash].map((b) => b.toString(16).padStart(2, '0')).join('') },
    ],
    attributesSource: 'asset',
  };
}

function verified(repo: string, commit: string, executableHash: string | null, daysAgo: number, now: number): VerifiedBuild {
  return {
    verified: true,
    repoUrl: repo,
    commit,
    executableHash,
    lastVerifiedAt: new Date((now - daysAgo * DAY) * 1000).toISOString(),
  };
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildDemoRegistry(nowMs: number = Date.now()): Promise<DemoRegistry> {
  const now = Math.floor(nowMs / 1000);

  const umbra = auditor(AUDITOR_PDAS.umbra, AUTHORITIES.umbra, COLLECTIONS.umbra, 'Umbra Security', 'https://umbra.example', true, 4);
  const osec = auditor(AUDITOR_PDAS.osec, AUTHORITIES.osec, COLLECTIONS.osec, 'OtterSec', 'https://osec.io', true, 2);
  const zellic = auditor(AUDITOR_PDAS.zellic, AUTHORITIES.zellic, COLLECTIONS.zellic, 'Zellic', 'https://zellic.io', false, 2);

  // The fixture the client tests assert byte-for-byte, decoded with the generated decoder.
  const fixtureAttestation = getAttestationDecoder().decode(
    getBase16Encoder().encode(fixtures.accounts.attestation),
  );

  const swapUmbra = await attestation(
    {
      address: 'WfK1b8fCTQG2b7FuASUvLh9HQHthdqAPmWnQwVbsVhG' as Address,
      auditor: umbra,
      program: PROGRAMS.swap,
      asset: '6SrPPzYHUM92otwXgvGR1Us6WLBKSLL8MJ7JmGD8vGRy' as Address,
      deploySlot: 312_901_002n,
      status: AttestationStatus.Valid,
      version: 2,
      findings: findings(0, 1, 2, 5, 3),
      reportUri: 'https://umbra.example/reports/swap-router-v2.pdf',
      issuedAgo: 31 * DAY,
      updatedAgo: 6 * DAY,
      expiresAt: 0n,
    },
    now,
  );
  const swapZellic = await attestation(
    {
      address: '8yhuGvGARaQ5L19tVhfgvdZkDv6R84ZgpcrbUEw2ow3U' as Address,
      auditor: zellic,
      program: PROGRAMS.swap,
      asset: '7DKp6PeJgyD9Dwc7s7wdKEMBLCD4VvRFsebAfa7oXMp1' as Address,
      deploySlot: 312_901_002n,
      status: AttestationStatus.Valid,
      version: 1,
      findings: findings(0, 0, 1, 2, 7),
      reportUri: 'https://zellic.io/reports/swap-router.pdf',
      issuedAgo: 12 * DAY,
      updatedAgo: 12 * DAY,
      expiresAt: BigInt(now + 180 * DAY),
    },
    now,
  );
  const vaultOsec = await attestation(
    {
      address: 'DG76ECB8Yr6toqYWpqx6xxffJBhU81Nt5Paa4n4nnNwg' as Address,
      auditor: osec,
      program: PROGRAMS.vault,
      asset: 'Ck68MgJbUNdnUqDjUvufFWP6zB1m32E2J4EV3VMLZG7V' as Address,
      deploySlot: 312_456_789n,
      status: AttestationStatus.Stale,
      version: 1,
      findings: findings(1, 2, 4, 6, 2),
      reportUri: 'https://osec.io/reports/vault.pdf',
      issuedAgo: 58 * DAY,
      updatedAgo: 2 * HOUR,
      expiresAt: 0n,
    },
    now,
  );
  const ammUmbra = await attestation(
    {
      address: 'DeC9rmaiMYA6zgXwva6p9HyHd6p2KTYEnPmk256J5rLJ' as Address,
      auditor: umbra,
      program: PROGRAMS.amm,
      asset: 'AhWFkUoqAkmwVjsEgQs67651vRfY8RDXfu2xe3ijYgV' as Address,
      deploySlot: 298_114_507n,
      status: AttestationStatus.Valid,
      version: 1,
      findings: findings(0, 0, 0, 1, 4),
      reportUri: 'https://umbra.example/reports/amm-core.pdf',
      issuedAgo: 96 * DAY,
      updatedAgo: 96 * DAY,
      expiresAt: 0n,
    },
    now,
  );
  const lendZellic = await attestation(
    {
      address: 'EDkZK8kGahsbYADuvhdRu3pn6uvcuCt62xzWWPmdeKQh' as Address,
      auditor: zellic,
      program: PROGRAMS.lend,
      asset: '957Jxfq2S6CAgYcASPbmQhYxKupsXDnQJRnd194gT2Uv' as Address,
      deploySlot: 311_002_455n,
      status: AttestationStatus.Revoked,
      version: 1,
      findings: findings(2, 3, 1, 0, 1),
      reportUri: 'https://zellic.io/reports/lend.pdf',
      issuedAgo: 44 * DAY,
      updatedAgo: 9 * DAY,
      expiresAt: 0n,
      revokeReason: 2,
    },
    now,
  );
  const oracleOsec = await attestation(
    {
      address: 'E3TbLK7PsLk9CFx4kxQEom5bqvm92Ei7WAndvTxxRSLL' as Address,
      auditor: osec,
      program: PROGRAMS.oracle,
      asset: 'ABKde4eDwdcjEBbhcpbs85678mxSGoMMnhLvdWqK5QPN' as Address,
      deploySlot: 305_776_120n,
      status: AttestationStatus.Expired,
      version: 1,
      findings: findings(0, 1, 1, 3, 2),
      reportUri: 'https://osec.io/reports/oracle.pdf',
      issuedAgo: 400 * DAY,
      updatedAgo: 35 * DAY,
      expiresAt: BigInt(now - 34 * DAY),
    },
    now,
  );
  const closedUmbra = await attestation(
    {
      address: '53m86YjDwxZASr35EE1esDKDbhdpun8QMAm97vYDik4Y' as Address,
      auditor: umbra,
      program: PROGRAMS.closed,
      asset: '8KE7MguTmh6UmDjggjqpyse5cgn2qBiQ1aiLgHCUJ6Co' as Address,
      deploySlot: 309_441_880n,
      status: AttestationStatus.ProgramClosed,
      version: 1,
      findings: findings(0, 0, 2, 2, 1),
      reportUri: 'https://umbra.example/reports/retired.pdf',
      issuedAgo: 120 * DAY,
      updatedAgo: 20 * DAY,
      expiresAt: 0n,
    },
    now,
  );

  // Stored status says Stale, but the live slot still matches the pin: `sync_status` has not run.
  const counterUmbra: AttestationRecord = {
    address: fixtures.pdas.attestation as Address,
    auditor: umbra,
    data: { ...fixtureAttestation, issuedAt: BigInt(now - 20 * DAY), updatedAt: BigInt(now - 3 * DAY) },
  };

  const attestations = [swapUmbra, swapZellic, vaultOsec, ammUmbra, lendZellic, oracleOsec, closedUmbra, counterUmbra];

  const deployStates = new Map<Address, DeployState | null>([
    [PROGRAMS.swap, { slot: 312_901_002n, upgradeAuthority: OWNERS.swap }],
    [PROGRAMS.vault, { slot: 313_204_915n, upgradeAuthority: OWNERS.vault }],
    [PROGRAMS.amm, { slot: 298_114_507n, upgradeAuthority: null }],
    [PROGRAMS.lend, { slot: 311_002_455n, upgradeAuthority: OWNERS.other }],
    [PROGRAMS.oracle, { slot: 305_776_120n, upgradeAuthority: OWNERS.other }],
    [PROGRAMS.closed, null],
    [PROGRAMS.counter, { slot: counterUmbra.data.deploySlot, upgradeAuthority: fixtures.keys.owner as Address }],
  ]);

  const certificates = new Map<Address, Certificate>([
    [swapUmbra.data.asset, certificate(swapUmbra, OWNERS.swap)],
    [swapZellic.data.asset, certificate(swapZellic, OWNERS.swap)],
    [vaultOsec.data.asset, certificate(vaultOsec, OWNERS.vault)],
    [ammUmbra.data.asset, certificate(ammUmbra, OWNERS.other)],
    [lendZellic.data.asset, certificate(lendZellic, OWNERS.other)],
    [oracleOsec.data.asset, certificate(oracleOsec, OWNERS.other)],
    [closedUmbra.data.asset, certificate(closedUmbra, OWNERS.other)],
    [counterUmbra.data.asset, certificate(counterUmbra, fixtures.keys.owner as Address)],
  ]);

  const verifiedBuilds = new Map<Address, VerifiedBuild>([
    [
      PROGRAMS.swap,
      verified('https://github.com/umbra-example/swap-router', 'a3f91c47e2b8d05f6c1427ab9e3d88f0c5127b4a', hex(swapUmbra.data.executableHash), 6, now),
    ],
    // Verified, but against newer source than the audit pinned: the commit is not the audited one.
    [PROGRAMS.vault, verified('https://github.com/example-labs/vault', '7c2e9aa41f3b8e05d6a7c9140b2f3e88a5c61d9b', hex(hash(99)), 1, now),
    ],
    [
      PROGRAMS.amm,
      verified('https://github.com/example-labs/amm-core', '4b17d9e0c85a2f3716e9b8d4c0a5f21e78b6c943', hex(ammUmbra.data.executableHash), 96, now),
    ],
    [
      PROGRAMS.counter,
      verified('https://github.com/umbra-example/demo-counter', 'de91f7a4c0b85236e1d7f94a85c0b31e2f6a7d48', hex(counterUmbra.data.executableHash), 20, now),
    ],
  ]);

  const V = AttestationStatus.Valid;
  const statusChanges: StatusChange[] = [
    change('1', vaultOsec, V, AttestationStatus.Stale, now - 2 * HOUR),
    change('2', lendZellic, V, AttestationStatus.Revoked, now - 9 * DAY),
    change('3', counterUmbra, V, AttestationStatus.Stale, now - 3 * DAY),
    change('4', swapUmbra, AttestationStatus.Stale, V, now - 6 * DAY),
    change('5', closedUmbra, V, AttestationStatus.ProgramClosed, now - 20 * DAY),
    change('6', oracleOsec, V, AttestationStatus.Expired, now - 34 * DAY),
    change('7', swapZellic, null, V, now - 12 * DAY),
    change('8', ammUmbra, null, V, now - 96 * DAY),
  ];

  const programNames = new Map<Address, string>([
    [PROGRAMS.swap, 'swap_router'],
    [PROGRAMS.vault, 'vault'],
    [PROGRAMS.amm, 'amm_core'],
    [PROGRAMS.lend, 'lend_pool'],
    [PROGRAMS.oracle, 'price_oracle'],
    [PROGRAMS.closed, 'retired_v1'],
    [PROGRAMS.counter, 'demo_counter'],
  ]);

  return {
    auditors: [umbra, osec, zellic],
    attestations,
    deployStates,
    certificates,
    verifiedBuilds,
    statusChanges,
    programNames,
  };
}

function change(
  id: string,
  record: AttestationRecord,
  from: AttestationStatus | null,
  to: AttestationStatus,
  at: number,
): StatusChange {
  return {
    id,
    attestation: record.address,
    program: record.data.program,
    auditorName: record.auditor.data.name,
    auditorAuthority: record.auditor.data.authority,
    kind: from === null ? 'issued' : 'changed',
    from,
    to,
    at: BigInt(at),
  };
}

export const DEMO_PROGRAMS = PROGRAMS;

/** The auditor the demo "connect" button signs in as: Umbra Security, from the test fixture. */
export const DEMO_AUDITOR = {
  authority: AUTHORITIES.umbra,
  name: 'Umbra Security',
};
