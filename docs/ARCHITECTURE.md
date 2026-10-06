# Seal — on-chain audit attestations that know when they're stale

> Solana School Fall Class capstone · Demo Day Oct 16, 2026

## 1. Problem

An audit report is a PDF about **one version** of a program's bytecode. Solana programs are
upgradeable by default, so the moment the upgrade authority redeploys, "audited by X" silently
stops being true. Nothing on-chain lets a wallet, a frontend or another program ask:

> *Is the code running at this address right now the code that was audited?*

## 2. Core insight

The BPF Upgradeable Loader already records when code changed. Every upgradeable program has a
`ProgramData` account whose header is:

```
UpgradeableLoaderState::ProgramData {
    slot: u64,                               // slot of the last deploy / upgrade
    upgrade_authority_address: Option<Pubkey>,
}
```

`slot` is written by the loader on every deploy and upgrade and cannot be set by anyone else.
So an attestation that pins `deploy_slot` can be checked **trustlessly and cheaply**:

```
programdata.slot == attestation.deploy_slot   →  the audited code is still live
programdata.slot != attestation.deploy_slot   →  code changed since the audit (STALE)
```

No bytecode hashing on-chain, no oracle, one account read.

## 3. System overview

```
                 ┌──────────────────────────── on-chain ─────────────────────────────┐
                 │                                                                    │
 Auditor ──sign──▶  seal_registry (Anchor)                    BPF Upgradeable Loader  │
  (CLI)          │   ├─ Config PDA                              ├─ Program account    │
                 │   ├─ Auditor PDA ──owns──▶ Core Collection   └─ ProgramData ◀─read─┤
                 │   └─ Attestation PDA ──1:1──▶ Core Asset          (slot)           │
                 │          ▲                   (soulbound cert,                      │
                 │          │ CPI verify()       Attributes plugin)                    │
                 │   Other programs ("only integrate audited code")                   │
                 └────────────▲─────────────────────────────────────▲────────────────┘
                              │ sync_status() tx                    │ account updates
                      ┌───────┴────────┐    websocket push   ┌──────┴──────────┐
                      │   Dashboard    │ ◀────────────────── │     Watcher     │
                      │  (React, Codama│                     │ Geyser gRPC sub │
                      │   TS client)   │                     │ on ProgramData  │
                      └────────────────┘                     └─────────────────┘
```

| Component | Tech | Curriculum week |
|---|---|---|
| `seal_registry` program | Anchor 1.x, PDAs, CPI | 1–2 |
| Certificate NFT | Metaplex Core: collection, `PermanentFreezeDelegate` (soulbound), `Attributes` | 4 |
| `verify` hot path (stretch) | Pinocchio rewrite + CU comparison | 3 |
| TypeScript client | Codama from the Anchor IDL | 5 |
| Watcher | Yellowstone Geyser gRPC; RPC `accountSubscribe` fallback locally | 6 |
| Dashboard + CLI | React / Node | — |

## 4. Accounts

All PDAs are owned by `seal_registry`.

### Config — `["config"]`
| field | type | notes |
|---|---|---|
| admin | Pubkey | curates the auditor set |
| auditor_count | u32 | |
| attestation_count | u64 | |
| bump | u8 | |

### Auditor — `["auditor", authority]`
| field | type | notes |
|---|---|---|
| authority | Pubkey | the auditor's signing key |
| collection | Pubkey | Core collection holding all of this auditor's certificates |
| name | String ≤ 32 | |
| uri | String ≤ 128 | website / profile |
| active | bool | admin can suspend; suspended auditors cannot issue |
| attestations_issued | u32 | |
| bump | u8 | |

The Auditor PDA is the **update authority of its Core collection**, so only the program (signing
with the PDA seeds) can add certificates to it or edit their attributes. A certificate in the
"Seal · OtterSec" collection cannot be forged by anyone else.

### Attestation — `["attestation", auditor_pda, target_program]`
One live attestation per (auditor, program). A re-audit calls `reissue`, which bumps `version`.

| field | type | notes |
|---|---|---|
| auditor | Pubkey | Auditor PDA |
| program | Pubkey | audited program id |
| programdata | Pubkey | derived from the program account at issuance |
| asset | Pubkey | Core certificate asset |
| deploy_slot | u64 | **the pin**: `ProgramData.slot` at issuance |
| executable_hash | [u8; 32] | sha256 of the deployed ELF, computed off-chain (informational, matches `solana-verify`) |
| report_hash | [u8; 32] | sha256 of the report PDF |
| report_uri | String ≤ 200 | |
| findings | Findings { critical, high, medium, low, info: u16 } | |
| issued_at / updated_at | i64 | unix ts |
| expires_at | i64 | 0 = no expiry |
| status | AttestationStatus | last status written on-chain (see §6) |
| version | u16 | starts at 1 |
| bump | u8 | |

### Certificate — Metaplex Core asset (keypair address)
* **Owner:** the program's upgrade authority at issuance (or a supplied recipient if the program is immutable).
* **Collection:** the auditor's collection (update authority = Auditor PDA).
* **Plugins:**
  * `PermanentFreezeDelegate { frozen: true }`, authority `None` → soulbound, cannot be transferred or thawed by anyone.
  * `Attributes` → `program`, `deploy_slot`, `status`, `version`, `critical`, `high`, `medium`, `low`, `report_hash`. Readable by wallets, explorers and other programs; rewritten by `sync_status` / `revoke` / `reissue`.

The PDA is the source of truth; the Core asset is the public, wallet-visible face of it.

## 5. Instructions

| # | Instruction | Signer | What it does |
|---|---|---|---|
| 1 | `initialize` | admin | Creates Config. |
| 2 | `register_auditor(name, uri, collection_uri)` | admin + payer; collection keypair | Creates Auditor PDA and CPIs `CreateCollectionV2` with the PDA as update authority. |
| 3 | `set_auditor_active(active)` | admin | Suspend / reinstate. |
| 4 | `issue_attestation(args)` | auditor authority; asset keypair | Reads Program + ProgramData, checks `expected_deploy_slot`, creates Attestation PDA, CPIs `CreateV2` for the soulbound certificate in the auditor's collection (PDA signs as collection authority). |
| 5 | `verify()` → `AttestationStatus` | none (read-only) | Recomputes status from live ProgramData and clock; returns it via return data and emits `Verified`. Safe to CPI into. Never writes. |
| 6 | `sync_status()` | anyone (crank) | Recomputes status; if it differs from the stored one, writes it to the PDA and CPIs `UpdatePluginV1` to rewrite the certificate's `Attributes`. The watcher calls this. |
| 7 | `revoke(reason)` | auditor authority | Status → `Revoked` (terminal until reissue); updates certificate. |
| 8 | `reissue(args)` | auditor authority | After a re-audit: new `deploy_slot` (checked against `expected_deploy_slot`), hashes, findings, `version += 1`, status → `Valid`; updates certificate. |

### `issue_attestation` args
```rust
IssueArgs {
    expected_deploy_slot: u64,   // race guard, see §7
    executable_hash: [u8; 32],
    report_hash: [u8; 32],
    report_uri: String,
    cert_name: String,           // Core asset name
    cert_uri: String,            // Core asset metadata JSON
    findings: Findings,
    expires_at: i64,
}
```

## 6. Status model

```rust
enum AttestationStatus { Valid, Stale, Revoked, Expired, ProgramClosed }
```

`verify` / `sync_status` evaluate in this order (first match wins):

1. `stored == Revoked` → **Revoked**
2. ProgramData account no longer holds a `ProgramData` header (program closed) → **ProgramClosed**
3. `programdata.slot != deploy_slot` → **Stale**
4. `expires_at != 0 && now >= expires_at` → **Expired**
5. otherwise → **Valid**

An upgrade authority change without a redeploy does **not** make an attestation stale, because the code
is unchanged. Setting the authority to `None` (freezing the program) is the strongest possible
state and is shown as a positive signal on the dashboard.

## 7. Security considerations

| Threat | Mitigation |
|---|---|
| Fake ProgramData passed in | Program account must be owned by the Upgradeable Loader and deserialize to `Program { programdata_address }`; the passed ProgramData key must equal that address and also be loader-owned. |
| Program upgraded between the auditor's review and the issue tx | `expected_deploy_slot` must equal the live slot or `issue` fails with `DeploySlotMismatch`. |
| Forged certificate NFT | Certificates live in a collection whose update authority is the Auditor PDA; clients check collection membership **and** the Attestation PDA, never the NFT alone. |
| Rogue / compromised auditor | Admin can suspend (`active = false`); existing certs remain but the dashboard flags the auditor. The auditor can revoke its own certs. |
| Auditor issues a cert for a program that never hired it | Accepted for v1: an attestation is the auditor's signed claim and stakes the auditor's reputation. v2: an optional co-sign by the upgrade authority. |
| Stale Attributes on the NFT | Attributes are a cache. `verify` always reads live ProgramData; `sync_status` is permissionless so anyone can refresh. |
| Loader v4 / non-upgradeable (v2) programs | Out of scope for v1: `issue` fails with `UnsupportedLoader`. Loader-v2 programs are immutable and could be supported with a pinned `deploy_slot = 0`. |

## 8. Off-chain

**CLI (`seal issue`)** — dumps the program ELF, computes `executable_hash` (same as `solana-verify get-program-hash`), hashes the report PDF, reads the live `ProgramData.slot` for `expected_deploy_slot`, uploads metadata, sends `issue_attestation`.

**Watcher** — loads all Attestation accounts (`getProgramAccounts` with a discriminator filter), subscribes to their ProgramData addresses via Yellowstone Geyser gRPC. On an update whose slot differs from the pin, it sends `sync_status` and pushes the event to the dashboard over a websocket. Locally (Surfpool / test validator) the same interface is backed by RPC `accountSubscribe`.

**Dashboard** — paste a program id and get the live badge (Valid / Stale / Revoked / Expired), auditor, findings, report link, deploy slot vs current slot, and a live event feed. Built on the Codama-generated client.

## 9. Demo script (≈3 min)

1. Deploy `demo_counter`; the auditor runs `seal issue`. The dashboard shows **VALID**, and the certificate is visible in the wallet.
2. Show a second program that CPIs `verify()` and refuses to interact with anything not VALID.
3. Live: `solana program deploy` an upgrade. The watcher sees the ProgramData change and the badge flips to **STALE** within about a second. The certificate's `status` attribute in the wallet now reads `stale`.
4. The auditor runs `seal reissue`, and the badge is **VALID v2**.

## 10. Repository layout

```
seal/
├── Anchor.toml
├── Cargo.toml                      # workspace
├── docs/ARCHITECTURE.md
├── programs/seal-registry/
│   ├── src/
│   │   ├── lib.rs                  # entrypoints
│   │   ├── state.rs                # Config, Auditor, Attestation, enums
│   │   ├── errors.rs
│   │   ├── events.rs
│   │   ├── loader.rs               # Program/ProgramData parsing + status evaluation
│   │   ├── cert.rs                 # Metaplex Core CPI helpers
│   │   └── instructions/           # one file per instruction
│   └── tests/                      # LiteSVM integration tests
├── clients/js/                     # Codama-generated client (week 5)
├── apps/cli/
├── apps/watcher/                   # Geyser (week 6)
└── apps/dashboard/
```

## 11. Build plan to Oct 16

| Days | Deliverable |
|---|---|
| 1–4 | Program: config, auditor, issue, verify, with LiteSVM tests (happy path, stale after upgrade, bad ProgramData, slot race) |
| 5–7 | Core CPI (collection + soulbound cert), `sync_status`, `revoke`, `reissue` |
| 8–10 | Codama client, CLI, dashboard |
| 11–13 | Geyser watcher and live flip to stale; consumer demo program using CPI `verify` |
| 14–18 | Stretch: Pinocchio `verify`, devnet deploy, pitch rehearsal |
