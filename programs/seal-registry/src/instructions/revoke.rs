use anchor_lang::prelude::*;

use crate::cert::{self, AuditorSigner};
use crate::errors::SealError;
use crate::events::StatusChanged;
use crate::state::*;

#[derive(Accounts)]
pub struct Revoke<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// Suspended auditors may still revoke their own attestations.
    #[account(
        seeds = [AUDITOR_SEED, authority.key().as_ref()],
        bump = auditor.bump,
        has_one = authority,
        has_one = collection @ SealError::CollectionMismatch,
    )]
    pub auditor: Account<'info, Auditor>,
    #[account(mut, has_one = auditor, has_one = asset @ SealError::AssetMismatch)]
    pub attestation: Account<'info, Attestation>,
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

pub fn handle_revoke(ctx: Context<Revoke>, reason: u8) -> Result<()> {
    let att = &mut ctx.accounts.attestation;
    require!(att.status != AttestationStatus::Revoked, SealError::AlreadyRevoked);
    let from = att.status;
    att.status = AttestationStatus::Revoked;
    att.revoke_reason = reason;
    att.updated_at = Clock::get()?.unix_timestamp;

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

    emit!(StatusChanged {
        attestation: a.attestation.key(),
        program: a.attestation.program,
        from,
        to: AttestationStatus::Revoked,
    });
    Ok(())
}
