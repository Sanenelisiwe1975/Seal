//! Seal: on-chain audit attestations pinned to a program's deploy slot.
//! See docs/ARCHITECTURE.md.
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod cert;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod loader;
pub mod state;

use instructions::*;
use state::{AttestationParams, AttestationStatus};

declare_id!("SeaLXkRMwaEx7cWWcUtXyTPcbcvRK1Ma3DA3n6nMoEX");

#[program]
pub mod seal_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        handle_initialize(ctx)
    }

    pub fn register_auditor(
        ctx: Context<RegisterAuditor>,
        name: String,
        uri: String,
        collection_uri: String,
    ) -> Result<()> {
        handle_register_auditor(ctx, name, uri, collection_uri)
    }

    pub fn set_auditor_active(ctx: Context<SetAuditorActive>, active: bool) -> Result<()> {
        handle_set_auditor_active(ctx, active)
    }

    pub fn issue_attestation(
        ctx: Context<IssueAttestation>,
        args: AttestationParams,
        cert_name: String,
        cert_uri: String,
    ) -> Result<()> {
        handle_issue_attestation(ctx, args, cert_name, cert_uri)
    }

    pub fn verify(ctx: Context<Verify>) -> Result<AttestationStatus> {
        handle_verify(ctx)
    }

    pub fn sync_status(ctx: Context<SyncStatus>) -> Result<AttestationStatus> {
        handle_sync_status(ctx)
    }

    pub fn revoke(ctx: Context<Revoke>, reason: u8) -> Result<()> {
        handle_revoke(ctx, reason)
    }

    pub fn reissue(ctx: Context<Reissue>, args: AttestationParams) -> Result<()> {
        handle_reissue(ctx, args)
    }
}
