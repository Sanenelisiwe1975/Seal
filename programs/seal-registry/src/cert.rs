//! Metaplex Core CPI helpers. The mpl-core crate is used without its `anchor`
//! feature and driven through its generated CPI builders.

use anchor_lang::prelude::*;
use mpl_core::instructions::{CreateCollectionV2CpiBuilder, CreateV2CpiBuilder, UpdatePluginV1CpiBuilder};
use mpl_core::types::{
    Attribute, Attributes, PermanentFreezeDelegate, Plugin, PluginAuthority, PluginAuthorityPair,
};

use crate::state::Attestation;

fn hex8(bytes: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(16);
    for b in &bytes[..8] {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

/// On-chain attributes mirrored onto the certificate for wallets and explorers.
pub fn attributes_for(att: &Attestation) -> Plugin {
    let kv = |k: &str, v: String| Attribute { key: k.to_string(), value: v };
    Plugin::Attributes(Attributes {
        attribute_list: vec![
            kv("program", att.program.to_string()),
            kv("deploy_slot", att.deploy_slot.to_string()),
            kv("status", att.status.as_str().to_string()),
            kv("version", att.version.to_string()),
            kv("critical", att.findings.critical.to_string()),
            kv("high", att.findings.high.to_string()),
            kv("medium", att.findings.medium.to_string()),
            kv("low", att.findings.low.to_string()),
            kv("report_hash", hex8(&att.report_hash)),
        ],
    })
}

pub struct AuditorSigner<'a> {
    pub authority_key: &'a [u8],
    pub bump: u8,
}

impl AuditorSigner<'_> {
    pub fn with_seeds<R>(&self, f: impl FnOnce(&[&[&[u8]]]) -> R) -> R {
        let bump = [self.bump];
        let seeds: &[&[u8]] = &[crate::state::AUDITOR_SEED, self.authority_key, &bump];
        f(&[seeds])
    }
}

/// Create the auditor's collection; the Auditor PDA becomes its update authority.
#[allow(clippy::too_many_arguments)]
pub fn create_collection<'info>(
    core_program: &AccountInfo<'info>,
    collection: &AccountInfo<'info>,
    auditor_pda: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    name: String,
    uri: String,
) -> Result<()> {
    CreateCollectionV2CpiBuilder::new(core_program)
        .collection(collection)
        .update_authority(Some(auditor_pda))
        .payer(payer)
        .system_program(system_program)
        .name(name)
        .uri(uri)
        .invoke()?;
    Ok(())
}

/// Mint a soulbound certificate into the auditor's collection.
#[allow(clippy::too_many_arguments)]
pub fn mint_certificate<'info>(
    core_program: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    collection: &AccountInfo<'info>,
    auditor_pda: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    signer: &AuditorSigner,
    name: String,
    uri: String,
    att: &Attestation,
) -> Result<()> {
    let plugins = vec![
        PluginAuthorityPair {
            plugin: Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: true }),
            authority: Some(PluginAuthority::None),
        },
        PluginAuthorityPair {
            plugin: attributes_for(att),
            authority: Some(PluginAuthority::UpdateAuthority),
        },
    ];
    signer.with_seeds(|seeds| {
        CreateV2CpiBuilder::new(core_program)
            .asset(asset)
            .collection(Some(collection))
            .authority(Some(auditor_pda))
            .payer(payer)
            .owner(Some(owner))
            .system_program(system_program)
            .name(name)
            .uri(uri)
            .plugins(plugins)
            .invoke_signed(seeds)
    })?;
    Ok(())
}

/// Rewrite the certificate's Attributes to mirror the attestation.
#[allow(clippy::too_many_arguments)]
pub fn sync_certificate<'info>(
    core_program: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    collection: &AccountInfo<'info>,
    auditor_pda: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    signer: &AuditorSigner,
    att: &Attestation,
) -> Result<()> {
    signer.with_seeds(|seeds| {
        UpdatePluginV1CpiBuilder::new(core_program)
            .asset(asset)
            .collection(Some(collection))
            .payer(payer)
            .authority(Some(auditor_pda))
            .system_program(system_program)
            .plugin(attributes_for(att))
            .invoke_signed(seeds)
    })?;
    Ok(())
}
