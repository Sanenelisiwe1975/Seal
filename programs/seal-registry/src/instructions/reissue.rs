use anchor_lang::prelude::*;

use crate::cert::{self, AuditorSigner};
use crate::errors::SealError;
use crate::events::AttestationIssued;
use crate::instructions::validate_args;
use crate::loader;
use crate::state::*;

/// After a re-audit: re-pin to the current deploy slot and bump the version.
#[derive(Accounts)]
pub struct Reissue<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [AUDITOR_SEED, authority.key().as_ref()],
        bump = auditor.bump,
        has_one = authority,
        has_one = collection @ SealError::CollectionMismatch,
        constraint = auditor.active @ SealError::AuditorInactive,
    )]
    pub auditor: Account<'info, Auditor>,
    #[account(mut, has_one = auditor, has_one = asset @ SealError::AssetMismatch)]
    pub attestation: Account<'info, Attestation>,
    /// CHECK: pinned to the ProgramData address recorded at issuance.
    #[account(address = attestation.programdata)]
    pub target_programdata: UncheckedAccount<'info>,
    /// CHECK: equals attestation.asset (has_one); Core validates.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: equals auditor.collection (has_one); Core validates.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: address-constrained to Metaplex Core.
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_reissue(ctx: Context<Reissue>, args: AttestationParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    validate_args(&args, now)?;
    let live = loader::read_live(&ctx.accounts.target_programdata)?.ok_or(SealError::ProgramClosed)?;
    require!(live.slot == args.expected_deploy_slot, SealError::DeploySlotMismatch);

    let att = &mut ctx.accounts.attestation;
    att.deploy_slot = live.slot;
    att.executable_hash = args.executable_hash;
    att.report_hash = args.report_hash;
    att.report_uri = args.report_uri;
    att.findings = args.findings;
    att.expires_at = args.expires_at;
    att.updated_at = now;
    att.status = AttestationStatus::Valid;
    att.revoke_reason = 0;
    att.version = att.version.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;

    let a = &ctx.accounts;
    let signer = AuditorSigner { authority_key: a.authority.key.as_ref(), bump: a.auditor.bump };
    cert::sync_certificate(
        &a.mpl_core_program.to_account_info(),
        &a.asset.to_account_info(),
        &a.collection.to_account_info(),
        &a.auditor.to_account_info(),
        &a.authority.to_account_info(),
        &a.system_program.to_account_info(),
        &signer,
        &a.attestation,
    )?;

    let att = &a.attestation;
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
