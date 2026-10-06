use anchor_lang::prelude::*;

use crate::state::AttestationStatus;

#[event]
pub struct AuditorRegistered {
    pub auditor: Pubkey,
    pub authority: Pubkey,
    pub collection: Pubkey,
}

#[event]
pub struct AttestationIssued {
    pub attestation: Pubkey,
    pub auditor: Pubkey,
    pub program: Pubkey,
    pub asset: Pubkey,
    pub deploy_slot: u64,
    pub version: u16,
}

#[event]
pub struct Verified {
    pub attestation: Pubkey,
    pub program: Pubkey,
    pub status: AttestationStatus,
    pub pinned_slot: u64,
    pub live_slot: Option<u64>,
}

#[event]
pub struct StatusChanged {
    pub attestation: Pubkey,
    pub program: Pubkey,
    pub from: AttestationStatus,
    pub to: AttestationStatus,
}
