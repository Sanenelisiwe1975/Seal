use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const AUDITOR_SEED: &[u8] = b"auditor";
pub const ATTESTATION_SEED: &[u8] = b"attestation";

pub const MAX_AUDITOR_NAME: usize = 32;
pub const MAX_AUDITOR_URI: usize = 128;
pub const MAX_REPORT_URI: usize = 200;
pub const MAX_CERT_NAME: usize = 64;
pub const MAX_CERT_URI: usize = 200;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub auditor_count: u32,
    pub attestation_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Auditor {
    /// Signing key of the audit firm.
    pub authority: Pubkey,
    /// Metaplex Core collection holding this auditor's certificates.
    /// Its update authority is this PDA.
    pub collection: Pubkey,
    #[max_len(MAX_AUDITOR_NAME)]
    pub name: String,
    #[max_len(MAX_AUDITOR_URI)]
    pub uri: String,
    pub active: bool,
    pub attestations_issued: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Attestation {
    /// Auditor PDA that issued this attestation.
    pub auditor: Pubkey,
    /// Audited program id.
    pub program: Pubkey,
    /// ProgramData account of `program` (loader-v3 PDA).
    pub programdata: Pubkey,
    /// Metaplex Core certificate asset.
    pub asset: Pubkey,
    /// `ProgramData.slot` at issuance. The attestation is only valid while this matches.
    pub deploy_slot: u64,
    /// sha256 of the deployed ELF, computed off-chain (informational).
    pub executable_hash: [u8; 32],
    /// sha256 of the audit report document.
    pub report_hash: [u8; 32],
    #[max_len(MAX_REPORT_URI)]
    pub report_uri: String,
    pub findings: Findings,
    pub issued_at: i64,
    pub updated_at: i64,
    /// 0 = never expires.
    pub expires_at: i64,
    /// Last status written on-chain. `verify` always recomputes from live state.
    pub status: AttestationStatus,
    pub revoke_reason: u8,
    pub version: u16,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, Debug, InitSpace)]
pub struct Findings {
    pub critical: u16,
    pub high: u16,
    pub medium: u16,
    pub low: u16,
    pub info: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AttestationStatus {
    Valid,
    Stale,
    Revoked,
    Expired,
    ProgramClosed,
}

impl AttestationStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            AttestationStatus::Valid => "valid",
            AttestationStatus::Stale => "stale",
            AttestationStatus::Revoked => "revoked",
            AttestationStatus::Expired => "expired",
            AttestationStatus::ProgramClosed => "program_closed",
        }
    }
}

/// Arguments shared by `issue_attestation` and `reissue`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AttestationParams {
    /// Must equal the live `ProgramData.slot`; guards against an upgrade landing
    /// between the auditor's review and this transaction.
    pub expected_deploy_slot: u64,
    pub executable_hash: [u8; 32],
    pub report_hash: [u8; 32],
    pub report_uri: String,
    pub findings: Findings,
    pub expires_at: i64,
}
