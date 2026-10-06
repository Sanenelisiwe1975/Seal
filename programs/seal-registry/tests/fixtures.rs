//! Writes `tests/client/fixtures.json`: the bytes the Rust/Anchor side produces for
//! fixed inputs. `tests/client/codama.test.ts` asserts the Codama-generated client
//! produces and decodes exactly the same bytes. Two clients, one truth.
//!
//! Regenerate with `npm run fixtures` after any program change.

use anchor_lang::{
    prelude::Pubkey, solana_program::bpf_loader_upgradeable, AccountSerialize, AnchorSerialize,
    InstructionData, ToAccountMetas,
};
use seal_registry::state::*;
use std::fmt::Write;

fn k(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}

fn hex(b: &[u8]) -> String {
    b.iter().fold(String::new(), |mut s, x| {
        let _ = write!(s, "{x:02x}");
        s
    })
}

fn metas(m: Vec<anchor_lang::prelude::AccountMeta>) -> String {
    let items: Vec<String> = m
        .iter()
        .map(|a| format!(r#"{{"address":"{}","signer":{},"writable":{}}}"#, a.pubkey, a.is_signer, a.is_writable))
        .collect();
    format!("[{}]", items.join(","))
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &seal_registry::ID).0
}

fn args() -> AttestationParams {
    AttestationParams {
        expected_deploy_slot: 312_456_789,
        executable_hash: [0xab; 32],
        report_hash: [0xcd; 32],
        report_uri: "https://umbra.example/reports/demo.pdf".into(),
        findings: Findings { critical: 0, high: 1, medium: 2, low: 3, info: 4 },
        expires_at: 1_798_761_600,
    }
}

#[test]
fn write_client_fixtures() {
    let (authority, target, asset, collection, owner) = (k(1), k(2), k(3), k(4), k(5));
    let config = pda(&[CONFIG_SEED]);
    let auditor = pda(&[AUDITOR_SEED, authority.as_ref()]);
    let attestation = pda(&[ATTESTATION_SEED, auditor.as_ref(), target.as_ref()]);
    let programdata = Pubkey::find_program_address(&[target.as_ref()], &bpf_loader_upgradeable::ID).0;

    let issue_data = seal_registry::instruction::IssueAttestation {
        args: args(),
        cert_name: "Seal: demo_counter".into(),
        cert_uri: "https://umbra.example/certs/demo.json".into(),
    }
    .data();
    let issue_metas = seal_registry::accounts::IssueAttestation {
        authority,
        config,
        auditor,
        attestation,
        target_program: target,
        target_programdata: programdata,
        asset,
        collection,
        cert_owner: owner,
        mpl_core_program: mpl_core::ID,
        system_program: anchor_lang::solana_program::system_program::ID,
    }
    .to_account_metas(None);

    let att = Attestation {
        auditor,
        program: target,
        programdata,
        asset,
        deploy_slot: 312_456_789,
        executable_hash: [0xab; 32],
        report_hash: [0xcd; 32],
        report_uri: "https://umbra.example/reports/demo.pdf".into(),
        findings: Findings { critical: 0, high: 1, medium: 2, low: 3, info: 4 },
        issued_at: 1_790_000_000,
        updated_at: 1_790_000_100,
        expires_at: 1_798_761_600,
        status: AttestationStatus::Stale,
        revoke_reason: 0,
        version: 2,
        bump: 254,
    };
    let mut att_bytes = Vec::new();
    att.try_serialize(&mut att_bytes).unwrap();

    let json = format!(
        r#"{{
  "programId": "{program_id}",
  "keys": {{ "authority": "{authority}", "target": "{target}", "asset": "{asset}", "collection": "{collection}", "owner": "{owner}" }},
  "pdas": {{ "config": "{config}", "auditor": "{auditor}", "attestation": "{attestation}", "programData": "{programdata}" }},
  "instructions": {{
    "issueAttestation": {{ "data": "{issue}", "accounts": {issue_metas} }},
    "verify": {{ "data": "{verify}" }},
    "syncStatus": {{ "data": "{sync}" }},
    "revoke": {{ "data": "{revoke}" }},
    "reissue": {{ "data": "{reissue}" }},
    "registerAuditor": {{ "data": "{register}" }}
  }},
  "accounts": {{ "attestation": "{att}" }},
  "returnData": {{ "stale": "{stale}" }}
}}
"#,
        program_id = seal_registry::ID,
        issue = hex(&issue_data),
        issue_metas = metas(issue_metas),
        verify = hex(&seal_registry::instruction::Verify {}.data()),
        sync = hex(&seal_registry::instruction::SyncStatus {}.data()),
        revoke = hex(&seal_registry::instruction::Revoke { reason: 3 }.data()),
        reissue = hex(&seal_registry::instruction::Reissue { args: args() }.data()),
        register = hex(
            &seal_registry::instruction::RegisterAuditor {
                name: "Umbra Security".into(),
                uri: "https://umbra.example".into(),
                collection_uri: "https://umbra.example/collection.json".into(),
            }
            .data()
        ),
        att = hex(&att_bytes),
        stale = hex(&borsh_bytes(&AttestationStatus::Stale)),
    );
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/client/fixtures.json");
    std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
    std::fs::write(path, json).unwrap();
}

fn borsh_bytes<T: AnchorSerialize>(v: &T) -> Vec<u8> {
    let mut out = Vec::new();
    v.serialize(&mut out).unwrap();
    out
}
