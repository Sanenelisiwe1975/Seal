pub mod initialize;
pub mod issue_attestation;
pub mod register_auditor;
pub mod reissue;
pub mod revoke;
pub mod set_auditor_active;
pub mod sync_status;
pub mod verify;

pub use initialize::*;
pub use issue_attestation::*;
pub use register_auditor::*;
pub use reissue::*;
pub use revoke::*;
pub use set_auditor_active::*;
pub use sync_status::*;
pub use verify::*;

use anchor_lang::prelude::*;

use crate::errors::SealError;
use crate::state::{AttestationParams, MAX_REPORT_URI};

pub(crate) fn require_len(s: &str, max: usize) -> Result<()> {
    require!(s.len() <= max, SealError::StringTooLong);
    Ok(())
}

pub(crate) fn validate_args(args: &AttestationParams, now: i64) -> Result<()> {
    require_len(&args.report_uri, MAX_REPORT_URI)?;
    require!(args.expires_at == 0 || args.expires_at > now, SealError::InvalidExpiry);
    Ok(())
}
