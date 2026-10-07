import type { ReadonlyUint8Array } from '@solana/kit';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { useCopy } from './useCopy';
import styles from './Address.module.css';

export function toHex(bytes: ReadonlyUint8Array | Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type HashProps = {
  /** Raw bytes (an account field) or an already-hex string (an external service's answer). */
  value: ReadonlyUint8Array | Uint8Array | string;
  label: string;
  lead?: number;
  tail?: number;
  full?: boolean;
};

/** A sha256 digest or commit: monospace, truncated, full value on hover, copy on click. */
export function Hash({ value, label, lead = 8, tail = 6, full = false }: HashProps) {
  const hex = typeof value === 'string' ? value : toHex(value);
  const { copied, copy } = useCopy(hex);
  const shown = full || hex.length <= lead + tail + 1 ? hex : `${hex.slice(0, lead)}…${hex.slice(-tail)}`;

  return (
    <Tooltip label={copied ? 'Copied' : hex} mono>
      <button
        type="button"
        onClick={copy}
        className={`${styles.value} ${full ? styles.full : ''} ${copied ? styles.copied : ''}`}
        aria-label={`Copy ${label} ${hex}`}
      >
        {shown}
        <Icon name={copied ? 'check' : 'copy'} size={11} />
      </button>
    </Tooltip>
  );
}
