//! LiteSVM integration tests for seal-registry.
//!
//! Prerequisites (run once from the repo root):
//!   anchor build                                   # -> target/deploy/seal_registry.so
//!   solana program dump -um CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d \
//!       programs/seal-registry/tests/fixtures/mpl_core.so
//! Then: cargo test -p seal-registry
//!
//! The audited "target program" is simulated by writing loader-v3 Program and
//! ProgramData accounts directly, so an "upgrade" is just a new ProgramData slot.

use anchor_lang::{
    prelude::{AccountMeta, Pubkey},
    solana_program::{bpf_loader_upgradeable, instruction::Instruction},
    AccountDeserialize, AnchorDeserialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use seal_registry::state::{
    Attestation, AttestationParams, AttestationStatus, Auditor, Config, Findings, ATTESTATION_SEED,
    AUDITOR_SEED, CONFIG_SEED,
};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::path::PathBuf;

const CORE: Pubkey = mpl_core::ID;
const SYSTEM: Pubkey = anchor_lang::solana_program::system_program::ID;

fn fixture(rel: &str) -> Option<Vec<u8>> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
    std::fs::read(&p).ok()
}

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    auditor_auth: Keypair,
    collection: Keypair,
    target: Pubkey,
    target_pd: Pubkey,
    upgrade_auth: Keypair,
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &seal_registry::ID).0
}

fn config_pda() -> Pubkey {
    pda(&[CONFIG_SEED])
}
fn auditor_pda(auth: &Pubkey) -> Pubkey {
    pda(&[AUDITOR_SEED, auth.as_ref()])
}
fn attestation_pda(auditor: &Pubkey, program: &Pubkey) -> Pubkey {
    pda(&[ATTESTATION_SEED, auditor.as_ref(), program.as_ref()])
}

/// Write loader-v3 Program + ProgramData accounts for `program` at `slot`.
fn set_target(svm: &mut LiteSVM, program: Pubkey, slot: u64, authority: Option<Pubkey>) -> Pubkey {
    let pd = Pubkey::find_program_address(&[program.as_ref()], &bpf_loader_upgradeable::ID).0;
    let mut p = 2u32.to_le_bytes().to_vec();
    p.extend_from_slice(pd.as_ref());
    // Not marked executable: LiteSVM would try to JIT the fake ELF. The registry
    // only relies on loader ownership + account layout, which only the loader can write.
    svm.set_account(
        program,
        Account { lamports: 1_000_000_000, data: p, owner: bpf_loader_upgradeable::ID, executable: false, rent_epoch: 0 },
    )
    .unwrap();
    let mut d = 3u32.to_le_bytes().to_vec();
    d.extend_from_slice(&slot.to_le_bytes());
    match authority {
        Some(a) => {
            d.push(1);
            d.extend_from_slice(a.as_ref());
        }
        None => {
            d.push(0);
            d.extend_from_slice(&[0u8; 32]);
        }
    }
    d.extend_from_slice(b"\x7fELF fake program bytes");
    svm.set_account(
        pd,
        Account { lamports: 1_000_000_000, data: d, owner: bpf_loader_upgradeable::ID, executable: false, rent_epoch: 0 },
    )
    .unwrap();
    pd
}

fn close_target(svm: &mut LiteSVM, pd: Pubkey) {
    // Closing a program drains its ProgramData account; a 0-lamport account is removed.
    svm.set_account(pd, Account { lamports: 0, data: vec![], owner: SYSTEM, executable: false, rent_epoch: 0 })
        .unwrap();
}

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair, signers: &[&Keypair]) -> Result<litesvm::types::TransactionMetadata, String> {
    let mut all: Vec<&Keypair> = vec![payer];
    all.extend_from_slice(signers);
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &all, svm.latest_blockhash());
    let r = svm.send_transaction(tx).map_err(|e| format!("{:?}\n{}", e.err, e.meta.logs.join("\n")));
    svm.expire_blockhash();
    r
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, key: &Pubkey) -> T {
    let acc = svm.get_account(key).expect("account missing");
    T::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

fn setup() -> Option<Env> {
    let (Some(seal), Some(core)) = (
        fixture("../../target/deploy/seal_registry.so"),
        fixture("tests/fixtures/mpl_core.so"),
    ) else {
        if std::env::var("SEAL_SKIP_SBF").is_ok() {
            eprintln!("SKIP: SEAL_SKIP_SBF set and program binaries missing");
            return None;
        }
        panic!(
            "missing target/deploy/seal_registry.so or tests/fixtures/mpl_core.so: \
             run `anchor build` and the `solana program dump` command in the header of tests/registry.rs"
        );
    };
    let mut svm = LiteSVM::new();
    svm.add_program(seal_registry::ID, &seal).unwrap();
    svm.add_program(CORE, &core).unwrap();

    let admin = Keypair::new();
    let auditor_auth = Keypair::new();
    let upgrade_auth = Keypair::new();
    for k in [&admin, &auditor_auth, &upgrade_auth] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }
    let target = Pubkey::new_unique();
    let target_pd = set_target(&mut svm, target, 1_000, Some(upgrade_auth.pubkey()));

    let mut env = Env { svm, admin, auditor_auth, collection: Keypair::new(), target, target_pd, upgrade_auth };

    let ix = Instruction {
        program_id: seal_registry::ID,
        accounts: seal_registry::accounts::Initialize {
            admin: env.admin.pubkey(),
            config: config_pda(),
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        data: seal_registry::instruction::Initialize {}.data(),
    };
    send(&mut env.svm, ix, &env.admin, &[]).unwrap();

    let ix = Instruction {
        program_id: seal_registry::ID,
        accounts: seal_registry::accounts::RegisterAuditor {
            admin: env.admin.pubkey(),
            config: config_pda(),
            authority: env.auditor_auth.pubkey(),
            auditor: auditor_pda(&env.auditor_auth.pubkey()),
            collection: env.collection.pubkey(),
            mpl_core_program: CORE,
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        data: seal_registry::instruction::RegisterAuditor {
            name: "Umbra Security".into(),
            uri: "https://umbra.example".into(),
            collection_uri: "https://umbra.example/collection.json".into(),
        }
        .data(),
    };
    let (admin, auth, col) = (env.admin.insecure_clone(), env.auditor_auth.insecure_clone(), env.collection.insecure_clone());
    send(&mut env.svm, ix, &admin, &[&auth, &col]).unwrap();
    Some(env)
}

fn args(slot: u64) -> AttestationParams {
    AttestationParams {
        expected_deploy_slot: slot,
        executable_hash: [7u8; 32],
        report_hash: [9u8; 32],
        report_uri: "https://umbra.example/reports/demo.pdf".into(),
        findings: Findings { critical: 0, high: 1, medium: 2, low: 3, info: 4 },
        expires_at: 0,
    }
}

fn issue_ix(env: &Env, asset: &Pubkey, owner: &Pubkey, a: AttestationParams) -> Instruction {
    let auditor = auditor_pda(&env.auditor_auth.pubkey());
    Instruction {
        program_id: seal_registry::ID,
        accounts: seal_registry::accounts::IssueAttestation {
            authority: env.auditor_auth.pubkey(),
            config: config_pda(),
            auditor,
            attestation: attestation_pda(&auditor, &env.target),
            target_program: env.target,
            target_programdata: env.target_pd,
            asset: *asset,
            collection: env.collection.pubkey(),
            cert_owner: *owner,
            mpl_core_program: CORE,
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        data: seal_registry::instruction::IssueAttestation {
            args: a,
            cert_name: "Seal: demo_counter".into(),
            cert_uri: "https://umbra.example/certs/demo.json".into(),
        }
        .data(),
    }
}

/// Issue a valid attestation; returns (asset pubkey, attestation pda).
fn issue(env: &mut Env) -> (Pubkey, Pubkey) {
    let asset = Keypair::new();
    let ix = issue_ix(env, &asset.pubkey(), &env.upgrade_auth.pubkey(), args(1_000));
    let auth = env.auditor_auth.insecure_clone();
    send(&mut env.svm, ix, &auth, &[&asset]).unwrap();
    let auditor = auditor_pda(&env.auditor_auth.pubkey());
    (asset.pubkey(), attestation_pda(&auditor, &env.target))
}

fn verify(env: &mut Env, att: &Pubkey) -> AttestationStatus {
    let ix = Instruction {
        program_id: seal_registry::ID,
        accounts: seal_registry::accounts::Verify { attestation: *att, target_programdata: env.target_pd }
            .to_account_metas(None),
        data: seal_registry::instruction::Verify {}.data(),
    };
    let payer = env.admin.insecure_clone();
    let meta = send(&mut env.svm, ix, &payer, &[]).unwrap();
    AttestationStatus::try_from_slice(&meta.return_data.data).unwrap()
}

fn sync_ix(env: &Env, att: &Pubkey, asset: &Pubkey, payer: &Pubkey) -> Instruction {
    Instruction {
        program_id: seal_registry::ID,
        accounts: seal_registry::accounts::SyncStatus {
            payer: *payer,
            attestation: *att,
            auditor: auditor_pda(&env.auditor_auth.pubkey()),
            target_programdata: env.target_pd,
            asset: *asset,
            collection: env.collection.pubkey(),
            mpl_core_program: CORE,
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        data: seal_registry::instruction::SyncStatus {}.data(),
    }
}

fn cert_attr(env: &Env, asset: &Pubkey, key: &str) -> String {
    let acc = env.svm.get_account(asset).unwrap();
    let a = mpl_core::Asset::deserialize(&acc.data).unwrap();
    a.plugin_list
        .attributes
        .unwrap()
        .attributes
        .attribute_list
        .into_iter()
        .find(|x| x.key == key)
        .unwrap()
        .value
}

#[test]
fn issue_mints_soulbound_certificate_and_verifies_valid() {
    let Some(mut env) = setup() else { return };
    let (asset, att) = issue(&mut env);

    let a: Attestation = read(&env.svm, &att);
    assert_eq!(a.program, env.target);
    assert_eq!(a.programdata, env.target_pd);
    assert_eq!(a.deploy_slot, 1_000);
    assert_eq!(a.asset, asset);
    assert_eq!(a.version, 1);
    assert_eq!(a.status, AttestationStatus::Valid);

    let acc = env.svm.get_account(&asset).unwrap();
    assert_eq!(acc.owner, CORE);
    let cert = mpl_core::Asset::deserialize(&acc.data).unwrap();
    assert_eq!(cert.base.owner, env.upgrade_auth.pubkey());
    let freeze = cert.plugin_list.permanent_freeze_delegate.expect("soulbound plugin");
    assert!(freeze.permanent_freeze_delegate.frozen);
    assert_eq!(cert_attr(&env, &asset, "status"), "valid");
    assert_eq!(cert_attr(&env, &asset, "deploy_slot"), "1000");

    let auditor: Auditor = read(&env.svm, &auditor_pda(&env.auditor_auth.pubkey()));
    assert_eq!(auditor.attestations_issued, 1);
    let config: Config = read(&env.svm, &config_pda());
    assert_eq!(config.attestation_count, 1);

    assert_eq!(verify(&mut env, &att), AttestationStatus::Valid);
}

#[test]
fn upgrade_makes_attestation_stale_and_sync_updates_certificate() {
    let Some(mut env) = setup() else { return };
    let (asset, att) = issue(&mut env);

    // The upgrade authority redeploys: the loader bumps ProgramData.slot.
    let upgrade_auth = env.upgrade_auth.pubkey();
    set_target(&mut env.svm, env.target, 2_000, Some(upgrade_auth));
    assert_eq!(verify(&mut env, &att), AttestationStatus::Stale);

    // Anyone can crank the stored status + certificate attributes.
    let cranker = Keypair::new();
    env.svm.airdrop(&cranker.pubkey(), 1_000_000_000).unwrap();
    let ix = sync_ix(&env, &att, &asset, &cranker.pubkey());
    send(&mut env.svm, ix, &cranker, &[]).unwrap();
    let a: Attestation = read(&env.svm, &att);
    assert_eq!(a.status, AttestationStatus::Stale);
    assert_eq!(cert_attr(&env, &asset, "status"), "stale");

    // Re-audit at the new slot restores validity and bumps the version.
    let ix = Instruction {
        program_id: seal_registry::ID,
        accounts: seal_registry::accounts::Reissue {
            authority: env.auditor_auth.pubkey(),
            auditor: auditor_pda(&env.auditor_auth.pubkey()),
            attestation: att,
            target_programdata: env.target_pd,
            asset,
            collection: env.collection.pubkey(),
            mpl_core_program: CORE,
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        data: seal_registry::instruction::Reissue { args: args(2_000) }.data(),
    };
    let auth = env.auditor_auth.insecure_clone();
    send(&mut env.svm, ix, &auth, &[]).unwrap();
    let a: Attestation = read(&env.svm, &att);
    assert_eq!((a.status, a.version, a.deploy_slot), (AttestationStatus::Valid, 2, 2_000));
    assert_eq!(cert_attr(&env, &asset, "status"), "valid");
    assert_eq!(cert_attr(&env, &asset, "version"), "2");
    assert_eq!(verify(&mut env, &att), AttestationStatus::Valid);
}

#[test]
fn closed_program_reports_program_closed() {
    let Some(mut env) = setup() else { return };
    let (_, att) = issue(&mut env);
    let pd = env.target_pd;
    close_target(&mut env.svm, pd);
    assert_eq!(verify(&mut env, &att), AttestationStatus::ProgramClosed);
}

#[test]
fn revoke_is_terminal_until_reissue() {
    let Some(mut env) = setup() else { return };
    let (asset, att) = issue(&mut env);
    let ix = Instruction {
        program_id: seal_registry::ID,
        accounts: seal_registry::accounts::Revoke {
            authority: env.auditor_auth.pubkey(),
            auditor: auditor_pda(&env.auditor_auth.pubkey()),
            attestation: att,
            asset,
            collection: env.collection.pubkey(),
            mpl_core_program: CORE,
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        data: seal_registry::instruction::Revoke { reason: 1 }.data(),
    };
    let auth = env.auditor_auth.insecure_clone();
    send(&mut env.svm, ix.clone(), &auth, &[]).unwrap();
    assert_eq!(verify(&mut env, &att), AttestationStatus::Revoked);
    assert_eq!(cert_attr(&env, &asset, "status"), "revoked");
    // Second revoke fails.
    assert!(send(&mut env.svm, ix, &auth, &[]).is_err());
}

#[test]
fn issue_rejects_slot_race() {
    let Some(mut env) = setup() else { return };
    let asset = Keypair::new();
    // Auditor reviewed slot 1000, but an upgrade landed first.
    let owner = env.upgrade_auth.pubkey();
    set_target(&mut env.svm, env.target, 1_500, Some(owner));
    let ix = issue_ix(&env, &asset.pubkey(), &owner, args(1_000));
    let auth = env.auditor_auth.insecure_clone();
    let err = send(&mut env.svm, ix, &auth, &[&asset]).unwrap_err();
    assert!(err.contains("DeploySlotMismatch"), "{err}");
}

#[test]
fn issue_rejects_wrong_certificate_owner() {
    let Some(mut env) = setup() else { return };
    let asset = Keypair::new();
    let ix = issue_ix(&env, &asset.pubkey(), &Pubkey::new_unique(), args(1_000));
    let auth = env.auditor_auth.insecure_clone();
    let err = send(&mut env.svm, ix, &auth, &[&asset]).unwrap_err();
    assert!(err.contains("InvalidCertificateOwner"), "{err}");
}

#[test]
fn issue_rejects_spoofed_programdata() {
    let Some(mut env) = setup() else { return };
    // Attacker creates a second "program" pinned at the expected slot and passes
    // its ProgramData alongside the real target.
    let decoy = Pubkey::new_unique();
    let owner = env.upgrade_auth.pubkey();
    let decoy_pd = set_target(&mut env.svm, decoy, 1_000, Some(owner));
    let asset = Keypair::new();
    let mut ix = issue_ix(&env, &asset.pubkey(), &owner, args(1_000));
    for m in ix.accounts.iter_mut() {
        if m.pubkey == env.target_pd {
            *m = AccountMeta::new_readonly(decoy_pd, false);
        }
    }
    let auth = env.auditor_auth.insecure_clone();
    let err = send(&mut env.svm, ix, &auth, &[&asset]).unwrap_err();
    assert!(err.contains("ProgramDataMismatch"), "{err}");
}

#[test]
fn suspended_auditor_cannot_issue() {
    let Some(mut env) = setup() else { return };
    let ix = Instruction {
        program_id: seal_registry::ID,
        accounts: seal_registry::accounts::SetAuditorActive {
            admin: env.admin.pubkey(),
            config: config_pda(),
            auditor: auditor_pda(&env.auditor_auth.pubkey()),
        }
        .to_account_metas(None),
        data: seal_registry::instruction::SetAuditorActive { active: false }.data(),
    };
    let admin = env.admin.insecure_clone();
    send(&mut env.svm, ix, &admin, &[]).unwrap();

    let asset = Keypair::new();
    let owner = env.upgrade_auth.pubkey();
    let ix = issue_ix(&env, &asset.pubkey(), &owner, args(1_000));
    let auth = env.auditor_auth.insecure_clone();
    let err = send(&mut env.svm, ix, &auth, &[&asset]).unwrap_err();
    assert!(err.contains("AuditorInactive"), "{err}");
}
