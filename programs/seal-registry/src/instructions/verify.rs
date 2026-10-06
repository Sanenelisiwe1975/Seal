use anchor_lang::prelude::*;

use crate::events::Verified;
use crate::loader;
use crate::state::*;

/// Read-only. Safe to CPI into: returns the live status via return data.
#[derive(Accounts)]
pub struct Verify<'info> {
    pub attestation: Account<'info, Attestation>,
    /// CHECK: pinned to the ProgramData address recorded at issuance.
    #[account(address = attestation.programdata)]
    pub target_programdata: UncheckedAccount<'info>,
}

pub fn handle_verify(ctx: Context<Verify>) -> Result<AttestationStatus> {
    let att = &ctx.accounts.attestation;
    let live = loader::read_live(&ctx.accounts.target_programdata)?;
    let now = Clock::get()?.unix_timestamp;
    let status = loader::evaluate(att.status, att.deploy_slot, att.expires_at, live.as_ref(), now);
    emit!(Verified {
        attestation: att.key(),
        program: att.program,
        status,
        pinned_slot: att.deploy_slot,
        live_slot: live.map(|h| h.slot),
    });
    Ok(status)
}
