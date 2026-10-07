// OtterSec verified builds: the link between an attestation and the exact source commit.
//
// A Seal attestation pins `ProgramData.slot`, which proves the *bytecode* has not changed.
// It does not say which source produced that bytecode. OtterSec's public verification service
// does: it rebuilds a program from a repo at a commit and reports whether the result matches
// the deployed ELF. Pairing the two lets the UI name the audited commit, not just a slot.
import { getBase16Decoder, type Address, type ReadonlyUint8Array } from '@solana/kit';

/** Public OtterSec verification API (same service `solana-verify` talks to). */
export const OSEC_VERIFY_API = 'https://verify.osec.io';

export type VerifiedBuild = {
  /** The service rebuilt the repo at `commit` and the result matched the on-chain ELF. */
  verified: boolean;
  /** Source repository, as reported by the service. */
  repoUrl: string | null;
  /** The exact commit that was built, if reported. */
  commit: string | null;
  /** sha256 of the ELF the service built, lowercase hex. Comparable to `Attestation.executableHash`. */
  executableHash: string | null;
  /** When the service last ran the verification, if reported. */
  lastVerifiedAt: string | null;
};

type OsecStatusResponse = {
  is_verified?: boolean;
  repo_url?: string | null;
  commit?: string | null;
  on_chain_hash?: string | null;
  executable_hash?: string | null;
  last_verified_at?: string | null;
};

export type FetchVerifiedBuildOptions = {
  /** Injectable for tests, demo mode and non-browser callers. */
  fetchImpl?: typeof fetch;
  endpoint?: string;
  abortSignal?: AbortSignal;
};

/**
 * Look up a program's verified build. Returns an unverified result rather than throwing when the
 * service has no record of the program, so a missing verified build never breaks a page: it is a
 * normal, expected state for most programs.
 */
export async function fetchVerifiedBuild(
  program: Address,
  options: FetchVerifiedBuildOptions = {},
): Promise<VerifiedBuild> {
  const { fetchImpl = fetch, endpoint = OSEC_VERIFY_API, abortSignal } = options;
  const response = await fetchImpl(`${endpoint}/status/${program}`, { signal: abortSignal });
  if (response.status === 404) return unverified();
  if (!response.ok) {
    throw new Error(`verified build lookup failed: ${response.status} ${response.statusText}`);
  }
  return normalizeOsecStatus((await response.json()) as OsecStatusResponse);
}

function unverified(): VerifiedBuild {
  return { verified: false, repoUrl: null, commit: null, executableHash: null, lastVerifiedAt: null };
}

export function normalizeOsecStatus(body: OsecStatusResponse): VerifiedBuild {
  const repoUrl = body.repo_url ?? null;
  return {
    verified: body.is_verified === true,
    repoUrl: repoUrl === null ? null : stripTreePath(repoUrl),
    commit: body.commit ?? commitFromRepoUrl(repoUrl),
    executableHash: (body.executable_hash ?? body.on_chain_hash ?? null)?.toLowerCase() ?? null,
    lastVerifiedAt: body.last_verified_at ?? null,
  };
}

/** The service sometimes reports the repo as `…/tree/<commit>`; keep the repo and the commit apart. */
function stripTreePath(repoUrl: string): string {
  return repoUrl.replace(/\.git$/, '').replace(/\/tree\/[^/]+\/?$/, '').replace(/\/$/, '');
}

function commitFromRepoUrl(repoUrl: string | null): string | null {
  const match = repoUrl?.match(/\/tree\/([0-9a-f]{7,40})\/?$/i);
  return match ? match[1] : null;
}

/** Link to the repository browsing the exact audited commit, for GitHub-style hosts. */
export function verifiedBuildCommitUrl(build: VerifiedBuild): string | null {
  if (!build.repoUrl || !build.commit) return null;
  try {
    const url = new URL(build.repoUrl);
    if (url.hostname !== 'github.com' && url.hostname !== 'gitlab.com') return build.repoUrl;
    return `${build.repoUrl}/tree/${build.commit}`;
  } catch {
    return null;
  }
}

/**
 * Whether the verified build describes the same bytecode the auditor recorded.
 * A mismatch means the verified build moved on from what was audited, so the commit it names is
 * *not* the audited source and must not be presented as such.
 */
export function verifiedBuildMatchesAttestation(
  build: VerifiedBuild,
  attestation: { executableHash: ReadonlyUint8Array },
): boolean {
  if (!build.verified || !build.executableHash) return false;
  return build.executableHash === getBase16Decoder().decode(attestation.executableHash);
}
