# Seal

On-chain audit attestations for Solana programs that **know when they're stale**.

An auditor issues an attestation pinned to the target program's `ProgramData.slot`, the slot the
BPF Upgradeable Loader writes on every deploy. When the program is upgraded, the slot moves and
the attestation is **Stale**, with no oracle and no bytecode hashing on-chain. Each attestation
comes with a soulbound Metaplex Core certificate that mirrors its status in wallets.

Design and threat model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Status

| Piece | State |
|---|---|
| `seal_registry` program: initialize, register_auditor, set_auditor_active, issue_attestation, verify, sync_status, revoke, reissue | ✅ written, host build + clippy clean |
| Loader parsing + status rules | ✅ unit tested, cross-checked against canonical bincode layout |
| LiteSVM integration tests (8) | ✅ written, needs the two `.so` files below to run |
| Codama TypeScript client (`clients/js`) | ✅ generated; 10 tests incl. byte-for-byte equality with Anchor |
| CLI, watcher (Geyser), dashboard | ⏳ next |

## Build and test

Requirements: Anchor CLI 1.2.x, Solana CLI (Agave) with `cargo build-sbf`, and Rust ≥ 1.95.

```bash
# 1. Program id: generate your own keypair and sync it into lib.rs / Anchor.toml
anchor keys sync

# 2. Build the SBF binary and IDL
anchor build

# 3. Fetch the Metaplex Core program for local tests
solana program dump -um CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d \
  programs/seal-registry/tests/fixtures/mpl_core.so

# 4. Unit + LiteSVM integration tests
cargo test -p seal-registry
```

The integration tests simulate the audited program by writing loader-v3 `Program` and
`ProgramData` accounts directly, so "upgrading" the target is just writing a new slot.

| Test | Proves |
|---|---|
| `issue_mints_soulbound_certificate_and_verifies_valid` | PDA fields, cert owned by upgrade authority, `PermanentFreezeDelegate` frozen, attributes, `verify` → Valid |
| `upgrade_makes_attestation_stale_and_sync_updates_certificate` | Upgrade → Stale; permissionless `sync_status` rewrites cert; `reissue` → Valid v2 |
| `closed_program_reports_program_closed` | Closed ProgramData → ProgramClosed |
| `revoke_is_terminal_until_reissue` | Revoke → Revoked on PDA + cert; double revoke fails |
| `issue_rejects_slot_race` | `expected_deploy_slot` guard |
| `issue_rejects_wrong_certificate_owner` | Cert must go to the upgrade authority |
| `issue_rejects_spoofed_programdata` | Decoy ProgramData from another program is rejected |
| `suspended_auditor_cannot_issue` | Admin suspension works |

## TypeScript client (Codama)

`clients/js` (`@seal/client`) is generated from `idl/seal_registry.json` by Codama and targets `@solana/kit`.

```bash
npm install
npm run idl          # anchor idl build -> idl/seal_registry.json
npm run generate     # codama run js -> clients/js/src/generated (do not edit by hand)
npm run fixtures     # Rust writes tests/client/fixtures.json
npm run test:client  # TS must produce/decode the same bytes as Anchor
npm run typecheck
```

- `codama.json` runs one `before` visitor, `codama/programdata-default.mjs`. It teaches the client that `targetProgramdata` in `issue_attestation` is the loader-v3 PDA of `targetProgram`, so `getIssueAttestationInstructionAsync` needs only authority, targetProgram, asset, collection, certOwner and the args. Config, auditor, attestation and ProgramData are derived.
- `clients/js/src/seal.ts` holds hand-written helpers: `fetchDeployState` (live slot for `expectedDeploySlot`), `evaluateStatus` (an off-chain mirror of the on-chain rules), and `simulateVerify` (asks the program itself, with no signature and no fees).
- Generated code is committed so reviewers see client diffs when the program changes. After any program change, rerun `idl → generate → fixtures → test:client`.

## Consuming `verify` from another program

`verify` is read-only and returns `AttestationStatus` as return data, so any program can gate on it:

```rust
let status = seal_registry::cpi::verify(CpiContext::new(
    seal_program.key(), // Anchor 1.x: CpiContext takes the program id
    seal_registry::cpi::accounts::Verify {
        attestation: attestation.to_account_info(),
        target_programdata: target_programdata.to_account_info(),
    },
))?.get();
require!(status == AttestationStatus::Valid, MyError::UnauditedCode);
```
