use anchor_lang::prelude::*;

#[error_code]
pub enum SealError {
    #[msg("Only the config admin can perform this action")]
    Unauthorized,
    #[msg("Auditor is suspended")]
    AuditorInactive,
    #[msg("String exceeds maximum length")]
    StringTooLong,
    #[msg("Target is not a BPF Upgradeable Loader program")]
    UnsupportedLoader,
    #[msg("ProgramData account does not belong to the target program")]
    ProgramDataMismatch,
    #[msg("Target program has been closed")]
    ProgramClosed,
    #[msg("Live deploy slot does not match expected_deploy_slot")]
    DeploySlotMismatch,
    #[msg("Certificate owner must be the program's upgrade authority")]
    InvalidCertificateOwner,
    #[msg("expires_at must be 0 or in the future")]
    InvalidExpiry,
    #[msg("Certificate asset does not match the attestation")]
    AssetMismatch,
    #[msg("Collection does not match the auditor")]
    CollectionMismatch,
    #[msg("Attestation is already revoked")]
    AlreadyRevoked,
}
