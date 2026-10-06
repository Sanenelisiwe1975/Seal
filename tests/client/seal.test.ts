// The off-chain status mirror must agree with loader.rs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { address, getAddressEncoder } from '@solana/kit';
import { AttestationStatus as S, evaluateStatus, findProgramDataAddress, parseProgramDataHeader } from '../../clients/js/src/index.ts';

const fx = JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));

function header(slot: bigint, auth: string | null): Uint8Array {
  const b = new Uint8Array(45 + 4);
  const v = new DataView(b.buffer);
  v.setUint32(0, 3, true);
  v.setBigUint64(4, slot, true);
  if (auth) { b[12] = 1; b.set(getAddressEncoder().encode(address(auth)), 13); }
  return b;
}

test('ProgramData PDA matches Rust', async () => {
  assert.equal(await findProgramDataAddress(address(fx.keys.target)), fx.pdas.programData);
});

test('parses ProgramData header', () => {
  assert.deepEqual(parseProgramDataHeader(header(42n, fx.keys.owner)), { slot: 42n, upgradeAuthority: fx.keys.owner });
  assert.deepEqual(parseProgramDataHeader(header(7n, null)), { slot: 7n, upgradeAuthority: null });
  const bad = header(7n, null); bad[0] = 2;
  assert.equal(parseProgramDataHeader(bad), null);
  assert.equal(parseProgramDataHeader(new Uint8Array(10)), null);
});

test('status rules mirror loader::evaluate', () => {
  const live = { slot: 100n, upgradeAuthority: null };
  const att = (status: S, deploySlot: bigint, expiresAt = 0n) => ({ status, deploySlot, expiresAt });
  assert.equal(evaluateStatus(att(S.Valid, 100n), live, 1n), S.Valid);
  assert.equal(evaluateStatus(att(S.Valid, 99n), live, 1n), S.Stale);
  assert.equal(evaluateStatus(att(S.Valid, 100n, 50n), live, 50n), S.Expired);
  assert.equal(evaluateStatus(att(S.Valid, 100n, 50n), live, 49n), S.Valid);
  assert.equal(evaluateStatus(att(S.Valid, 100n), null, 1n), S.ProgramClosed);
  assert.equal(evaluateStatus(att(S.Revoked, 100n), null, 1n), S.Revoked);
  assert.equal(evaluateStatus(att(S.Valid, 99n, 50n), live, 60n), S.Stale);
});
