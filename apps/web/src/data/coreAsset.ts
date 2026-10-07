import type { Attestation } from '@seal/client';
import {
  addDecoderSizePrefix,
  getAddressDecoder,
  getU32Decoder,
  getU8Decoder,
  getUtf8Decoder,
  type Address,
} from '@solana/kit';

/**
 * The fixed header of a Metaplex Core `AssetV1`: key | owner | update authority | name | uri.
 *
 * Only the header is decoded. The plugin registry that holds `Attributes` and
 * `PermanentFreezeDelegate` is a variable-length structure this app has no business reimplementing,
 * so plugin-derived values are either read from a source that owns them or shown as not read.
 */
export type CoreAssetHeader = {
  owner: Address;
  /** Set when the asset's update authority is a collection, which every Seal certificate's is. */
  collection: Address | null;
  name: string;
  uri: string;
};

const ASSET_V1_KEY = 1;
/** `UpdateAuthority` discriminants: 0 = None, 1 = Address, 2 = Collection. */
const UPDATE_AUTHORITY_ADDRESS = 1;
const UPDATE_AUTHORITY_COLLECTION = 2;

export function decodeCoreAssetHeader(data: Uint8Array): CoreAssetHeader | null {
  if (data.length < 35 || getU8Decoder().decode(data) !== ASSET_V1_KEY) return null;
  let offset = 1;

  const owner = getAddressDecoder().decode(data.subarray(offset, offset + 32));
  offset += 32;

  const authorityKind = getU8Decoder().decode(data.subarray(offset, offset + 1));
  offset += 1;
  let collection: Address | null = null;
  if (authorityKind === UPDATE_AUTHORITY_COLLECTION) {
    collection = getAddressDecoder().decode(data.subarray(offset, offset + 32));
    offset += 32;
  } else if (authorityKind === UPDATE_AUTHORITY_ADDRESS) {
    offset += 32;
  }

  const stringDecoder = addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder());
  const nameLength = getU32Decoder().decode(data.subarray(offset, offset + 4));
  const name = stringDecoder.decode(data.subarray(offset, offset + 4 + nameLength));
  offset += 4 + nameLength;

  const uriLength = getU32Decoder().decode(data.subarray(offset, offset + 4));
  const uri = stringDecoder.decode(data.subarray(offset, offset + 4 + uriLength));

  return { owner, collection, name, uri };
}

/**
 * The attribute values `issue_attestation` / `sync_status` write onto the certificate, derived from
 * the Attestation PDA. Presented as registry-sourced, never as having been read off the asset: the
 * on-chain plugin is a cache that only moves when `sync_status` runs.
 */
export function registryAttributes(attestation: Attestation): { key: string; value: string }[] {
  const hex = (bytes: Iterable<number>) =>
    [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    { key: 'program', value: attestation.program },
    { key: 'deploy_slot', value: String(attestation.deploySlot) },
    { key: 'version', value: String(attestation.version) },
    { key: 'critical', value: String(attestation.findings.critical) },
    { key: 'high', value: String(attestation.findings.high) },
    { key: 'medium', value: String(attestation.findings.medium) },
    { key: 'low', value: String(attestation.findings.low) },
    { key: 'report_hash', value: hex(attestation.reportHash) },
  ];
}
