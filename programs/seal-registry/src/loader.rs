//! BPF Upgradeable Loader (v3) account parsing and attestation status evaluation.
//!
//! Layouts are bincode-serialized `UpgradeableLoaderState` variants:
//!   Program     = u32 tag (2) | programdata: Pubkey                                  (36 bytes)
//!   ProgramData = u32 tag (3) | slot: u64 | Option<Pubkey> (u8 tag + 32 bytes)      (45-byte header, then ELF)
//! Parsed by hand to avoid a bincode dependency and to keep `verify` cheap.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;

use crate::errors::SealError;
use crate::state::AttestationStatus;

const TAG_PROGRAM: u32 = 2;
const TAG_PROGRAM_DATA: u32 = 3;
pub const PROGRAM_DATA_HEADER_LEN: usize = 4 + 8 + 1 + 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramDataHeader {
    pub slot: u64,
    pub upgrade_authority: Option<Pubkey>,
}

/// Parse a loader-v3 `Program` account's data, returning its ProgramData address.
pub fn parse_program(data: &[u8]) -> Option<Pubkey> {
    if data.len() < 36 || u32::from_le_bytes(data[0..4].try_into().ok()?) != TAG_PROGRAM {
        return None;
    }
    Some(Pubkey::new_from_array(data[4..36].try_into().ok()?))
}

/// Parse the header of a loader-v3 `ProgramData` account.
pub fn parse_program_data(data: &[u8]) -> Option<ProgramDataHeader> {
    if data.len() < PROGRAM_DATA_HEADER_LEN
        || u32::from_le_bytes(data[0..4].try_into().ok()?) != TAG_PROGRAM_DATA
    {
        return None;
    }
    let slot = u64::from_le_bytes(data[4..12].try_into().ok()?);
    let upgrade_authority = match data[12] {
        0 => None,
        1 => Some(Pubkey::new_from_array(data[13..45].try_into().ok()?)),
        _ => return None,
    };
    Some(ProgramDataHeader { slot, upgrade_authority })
}

/// Validate a target program + its ProgramData account at issuance time.
/// Returns the live header. Errors if anything is not a genuine, open loader-v3 program.
pub fn load_target(program: &AccountInfo, programdata: &AccountInfo) -> Result<ProgramDataHeader> {
    require_keys_eq!(*program.owner, bpf_loader_upgradeable::ID, SealError::UnsupportedLoader);
    let expected_pd = {
        let data = program.try_borrow_data()?;
        parse_program(&data).ok_or(SealError::UnsupportedLoader)?
    };
    require_keys_eq!(programdata.key(), expected_pd, SealError::ProgramDataMismatch);
    require_keys_eq!(*programdata.owner, bpf_loader_upgradeable::ID, SealError::ProgramClosed);
    let data = programdata.try_borrow_data()?;
    parse_program_data(&data).ok_or_else(|| error!(SealError::ProgramClosed))
}

/// Read the live ProgramData header for status evaluation. `None` means the program is closed.
/// The caller must already have checked the account key against the attestation.
pub fn read_live(programdata: &AccountInfo) -> Result<Option<ProgramDataHeader>> {
    if *programdata.owner != bpf_loader_upgradeable::ID {
        return Ok(None);
    }
    let data = programdata.try_borrow_data()?;
    Ok(parse_program_data(&data))
}

/// Status rules, first match wins (see docs/ARCHITECTURE.md §6).
pub fn evaluate(
    stored: AttestationStatus,
    pinned_slot: u64,
    expires_at: i64,
    live: Option<&ProgramDataHeader>,
    now: i64,
) -> AttestationStatus {
    if stored == AttestationStatus::Revoked {
        return AttestationStatus::Revoked;
    }
    let Some(live) = live else {
        return AttestationStatus::ProgramClosed;
    };
    if live.slot != pinned_slot {
        return AttestationStatus::Stale;
    }
    if expires_at != 0 && now >= expires_at {
        return AttestationStatus::Expired;
    }
    AttestationStatus::Valid
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pd_bytes(slot: u64, auth: Option<Pubkey>) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&TAG_PROGRAM_DATA.to_le_bytes());
        v.extend_from_slice(&slot.to_le_bytes());
        match auth {
            Some(k) => {
                v.push(1);
                v.extend_from_slice(k.as_ref());
            }
            None => {
                v.push(0);
                v.extend_from_slice(&[0u8; 32]);
            }
        }
        v.extend_from_slice(&[0x7f, b'E', b'L', b'F']);
        v
    }

    #[test]
    fn parses_program() {
        let pd = Pubkey::new_unique();
        let mut v = TAG_PROGRAM.to_le_bytes().to_vec();
        v.extend_from_slice(pd.as_ref());
        assert_eq!(parse_program(&v), Some(pd));
        v[0] = 3;
        assert_eq!(parse_program(&v), None);
        assert_eq!(parse_program(&v[..10]), None);
    }

    #[test]
    fn parses_program_data() {
        let auth = Pubkey::new_unique();
        let h = parse_program_data(&pd_bytes(42, Some(auth))).unwrap();
        assert_eq!(h.slot, 42);
        assert_eq!(h.upgrade_authority, Some(auth));
        let h = parse_program_data(&pd_bytes(7, None)).unwrap();
        assert_eq!(h.upgrade_authority, None);
        let mut bad = pd_bytes(7, None);
        bad[12] = 2;
        assert!(parse_program_data(&bad).is_none());
        assert!(parse_program_data(&[3, 0, 0, 0]).is_none());
    }

    #[test]
    fn matches_real_bincode_layout() {
        // Cross-check the hand-written parser against the canonical serializer.
        use anchor_lang::solana_program::bpf_loader_upgradeable::UpgradeableLoaderState;
        let auth = Pubkey::new_unique();
        let state = UpgradeableLoaderState::ProgramData {
            slot: 123_456,
            upgrade_authority_address: Some(auth),
        };
        let bytes = bincode::serialize(&state).unwrap();
        assert_eq!(bytes.len(), PROGRAM_DATA_HEADER_LEN);
        let h = parse_program_data(&bytes).unwrap();
        assert_eq!(h.slot, 123_456);
        assert_eq!(h.upgrade_authority, Some(auth));

        let pd = Pubkey::new_unique();
        let bytes = bincode::serialize(&UpgradeableLoaderState::Program {
            programdata_address: pd,
        })
        .unwrap();
        assert_eq!(parse_program(&bytes), Some(pd));
    }

    #[test]
    fn status_rules() {
        use AttestationStatus::*;
        let live = ProgramDataHeader { slot: 100, upgrade_authority: None };
        assert_eq!(evaluate(Valid, 100, 0, Some(&live), 1), Valid);
        assert_eq!(evaluate(Valid, 99, 0, Some(&live), 1), Stale);
        assert_eq!(evaluate(Valid, 100, 50, Some(&live), 50), Expired);
        assert_eq!(evaluate(Valid, 100, 50, Some(&live), 49), Valid);
        assert_eq!(evaluate(Valid, 100, 0, None, 1), ProgramClosed);
        // Revoked always wins, even over a closed program.
        assert_eq!(evaluate(Revoked, 100, 0, None, 1), Revoked);
        // Stale beats expired: code change is the more important signal.
        assert_eq!(evaluate(Valid, 99, 50, Some(&live), 60), Stale);
        // Evaluation depends only on live state (in practice a deploy slot never moves backwards).
        assert_eq!(evaluate(Stale, 100, 0, Some(&live), 1), Valid);
    }
}
