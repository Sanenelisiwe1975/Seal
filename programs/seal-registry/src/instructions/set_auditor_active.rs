use anchor_lang::prelude::*;

use crate::errors::SealError;
use crate::state::*;

#[derive(Accounts)]
pub struct SetAuditorActive<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SealError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [AUDITOR_SEED, auditor.authority.as_ref()], bump = auditor.bump)]
    pub auditor: Account<'info, Auditor>,
}

pub fn handle_set_auditor_active(ctx: Context<SetAuditorActive>, active: bool) -> Result<()> {
    ctx.accounts.auditor.active = active;
    Ok(())
}
