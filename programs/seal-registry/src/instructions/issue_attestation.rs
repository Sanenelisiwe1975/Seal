use anchor_lang::prelude::*;

use crate::cert::{self, AuditorSigner};
use crate::errors::SealError;
use crate::events::AttestationIssued;
use crate::instructions::{require_len, validate_args};
use crate::loader;
use crate::state::*;

#[derive(Accounts)]
pub struct IssueAttestation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [AUDITOR_SEED, authority.key().as_ref()],
        bump = auditor.bump,
        has_one = authority,
        has_one = collection @ SealError::CollectionMismatch,
        constraint = auditor.active @ SealError::AuditorInactive,
    )]
    pub auditor: Account<'info, Auditor>,
    #[account(
        init,
        payer = authority,
        space = 8 + Attestation::INIT_SPACE,
        seeds = [ATTESTATION_SEED, auditor.key().as_ref(), target_program.key().as_ref()],
        bump,
    )]
    pub attestation: Account<'info, Attestation>,
    /// CHECK: validated in `loader::load_target` (loader-owned, Program variant).
    pub target_program: UncheckedAccount<'info>,
    /// CHECK: validated in `loader::load_target` (derived from target_program).
    pub target_programdata: UncheckedAccount<'info>,
    /// Fresh keypair for the Core certificate.
    #[account(mut)]
    pub asset: Signer<'info>,
    /// CHECK: must equal `auditor.collection` (has_one above); Core validates the rest.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: receives the certificate; checked against the upgrade authority.
    pub cert_owner: UncheckedAccount<'info>,
    /// CHECK: address-constrained to Metaplex Core.
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_issue_attestation(
    ctx: Context<IssueAttestation>,
    args: AttestationParams,
    cert_name: String,
    cert_uri: String,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    validate_args(&args, now)?;
    require_len(&cert_name, MAX_CERT_NAME)?;
    require_len(&cert_uri, MAX_CERT_URI)?;

    let a = &ctx.accounts;
    let live = loader::load_target(&a.target_program, &a.target_programdata)?;
    require!(live.slot == args.expected_deploy_slot, SealError::DeploySlotMismatch);
    if let Some(upgrade_authority) = live.upgrade_authority {
        require_keys_eq!(a.cert_owner.key(), upgrade_authority, SealError::InvalidCertificateOwner);
    }

    let att = &mut ctx.accounts.attestation;
    att.auditor = ctx.accounts.auditor.key();
    att.program = ctx.accounts.target_program.key();
    att.programdata = ctx.accounts.target_programdata.key();
    att.asset = ctx.accounts.asset.key();
    att.deploy_slot = live.slot;
    att.executable_hash = args.executable_hash;
    att.report_hash = args.report_hash;
    att.report_uri = args.report_uri;
    att.findings = args.findings;
    att.issued_at = now;
    att.updated_at = now;
    att.expires_at = args.expires_at;
    att.status = AttestationStatus::Valid;
    att.revoke_reason = 0;
    att.version = 1;
    att.bump = ctx.bumps.attestation;

    let a = &ctx.accounts;
    let signer = AuditorSigner { authority_key: a.authority.key.as_ref(), bump: a.auditor.bump };
    cert::mint_certificate(
        &a.mpl_core_program.to_account_info(),
        &a.asset.to_account_info(),
        &a.collection.to_account_info(),
        &a.auditor.to_account_info(),
        &a.authority.to_account_info(),
        &a.cert_owner.to_account_info(),
        &a.system_program.to_account_info(),
        &signer,
        cert_name,
        cert_uri,
        &a.attestation,
    )?;

    ctx.accounts.auditor.attestations_issued += 1;
    ctx.accounts.config.attestation_count += 1;

    let att = &ctx.accounts.attestation;
    emit!(AttestationIssued {
        attestation: att.key(),
        auditor: att.auditor,
        program: att.program,
        asset: att.asset,
        deploy_slot: att.deploy_slot,
        version: att.version,
    });
    Ok(())
}
