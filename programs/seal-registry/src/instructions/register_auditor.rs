use anchor_lang::prelude::*;

use crate::cert;
use crate::errors::SealError;
use crate::events::AuditorRegistered;
use crate::instructions::require_len;
use crate::state::*;

#[derive(Accounts)]
pub struct RegisterAuditor<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SealError::Unauthorized,
    )]
    pub config: Account<'info, Config>,
    /// The audit firm's signing key; must sign to prove control.
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Auditor::INIT_SPACE,
        seeds = [AUDITOR_SEED, authority.key().as_ref()],
        bump,
    )]
    pub auditor: Account<'info, Auditor>,
    /// Fresh keypair for the auditor's Core collection.
    #[account(mut)]
    pub collection: Signer<'info>,
    /// CHECK: address-constrained to Metaplex Core.
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_auditor(
    ctx: Context<RegisterAuditor>,
    name: String,
    uri: String,
    collection_uri: String,
) -> Result<()> {
    require_len(&name, MAX_AUDITOR_NAME)?;
    require_len(&uri, MAX_AUDITOR_URI)?;
    require_len(&collection_uri, MAX_CERT_URI)?;

    let a = &ctx.accounts;
    cert::create_collection(
        &a.mpl_core_program.to_account_info(),
        &a.collection.to_account_info(),
        &a.auditor.to_account_info(),
        &a.admin.to_account_info(),
        &a.system_program.to_account_info(),
        format!("Seal · {name}"),
        collection_uri,
    )?;

    let auditor = &mut ctx.accounts.auditor;
    auditor.authority = ctx.accounts.authority.key();
    auditor.collection = ctx.accounts.collection.key();
    auditor.name = name;
    auditor.uri = uri;
    auditor.active = true;
    auditor.attestations_issued = 0;
    auditor.bump = ctx.bumps.auditor;

    ctx.accounts.config.auditor_count += 1;

    emit!(AuditorRegistered {
        auditor: auditor.key(),
        authority: auditor.authority,
        collection: auditor.collection,
    });
    Ok(())
}
