import type { Address as SolanaAddress } from '@solana/kit';
import { useCluster } from '../data/SealApiProvider';
import { explorerAccountUrl } from '../lib/cluster';
import { truncateAddress } from '../lib/format';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { useCopy } from './useCopy';
import styles from './Address.module.css';

export type AddressProps = {
  value: SolanaAddress | string;
  /** Shows the whole value instead of `Abcd…wxyz`. */
  full?: boolean;
  /** Adds an explorer link for the selected cluster. */
  explorer?: boolean;
  lead?: number;
  tail?: number;
};

/**
 * An address: truncated monospace, the full value in a tooltip, copy on click with a brief
 * confirmation, and optionally a link to the explorer for the cluster in use.
 */
export function Address({ value, full = false, explorer = true, lead = 4, tail = 4 }: AddressProps) {
  const cluster = useCluster();
  const { copied, copy } = useCopy(value);
  const shown = full ? value : truncateAddress(value, lead, tail);

  return (
    <span className={styles.wrapper}>
      <Tooltip label={copied ? 'Copied' : value} mono>
        <button
          type="button"
          onClick={copy}
          className={`${styles.value} ${full ? styles.full : ''} ${copied ? styles.copied : ''}`}
          aria-label={`Copy address ${value}`}
        >
          {shown}
          <Icon name={copied ? 'check' : 'copy'} size={11} />
        </button>
      </Tooltip>
      {copied ? (
        <span className={styles.confirmation} role="status">
          Copied
        </span>
      ) : null}
      {explorer ? (
        <a
          className={styles.link}
          href={explorerAccountUrl(value, cluster)}
          target="_blank"
          rel="noreferrer"
          aria-label={`View ${truncateAddress(value)} on Solana Explorer`}
        >
          <Icon name="external" size={12} />
        </a>
      ) : null}
    </span>
  );
}
