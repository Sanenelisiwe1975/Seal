use anchor_lang::prelude::*;

use crate::cert::{self, AuditorSigner};
use crate::errors::SealError;
use crate::events::StatusChanged;
use crate::loader;
use crate::state::*;

/// Permissionless crank: persists the live status and mirrors it onto the certificate.
#[derive(Accounts)]
pub struct SyncStatus<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, has_one = auditor, has_one = asset @ SealError::AssetMismatch)]
    pub attestation: Account<'info, Attestation>,
    #[account(
        seeds = [AUDITOR_SEED, auditor.authority.as_ref()],
        bump = auditor.bump,
        has_one = collection @ SealError::CollectionMismatch,
    )]
    pub auditor: Account<'info, Auditor>,
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

pub fn handle_sync_status(ctx: Context<SyncStatus>) -> Result<AttestationStatus> {
    let live = loader::read_live(&ctx.accounts.target_programdata)?;
    let now = Clock::get()?.unix_timestamp;
    let att = &mut ctx.accounts.attestation;
    let from = att.status;
    let to = loader::evaluate(from, att.deploy_slot, att.expires_at, live.as_ref(), now);
    if from == to {
        return Ok(to);
    }
    att.status = to;
    att.updated_at = now;

    let a = &ctx.accounts;
    let signer = AuditorSigner { authority_key: a.auditor.authority.as_ref(), bump: a.auditor.bump };
    cert::sync_certificate(
        &a.mpl_core_program.to_account_info(),
        &a.asset.to_account_info(),
        &a.collection.to_account_info(),
        &a.auditor.to_account_info(),
        &a.payer.to_account_info(),
        &a.system_program.to_account_info(),
        &signer,
        &a.attestation,
    )?;

    emit!(StatusChanged { attestation: a.attestation.key(), program: a.attestation.program, from, to });
    Ok(to)
}
