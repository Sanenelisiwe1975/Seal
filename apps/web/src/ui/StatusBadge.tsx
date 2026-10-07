import { AttestationStatus } from '@seal/client';
import { statusLabel } from '../lib/format';
import { Icon, type IconName } from './Icon';
import styles from './StatusBadge.module.css';

type StatusStyle = { className: string; icon: IconName };

/** Each status carries a word, a colour and a distinct shape, so colour is never the only signal. */
const STATUS_STYLES: Record<AttestationStatus, StatusStyle> = {
  [AttestationStatus.Valid]: { className: 'valid', icon: 'check-circle' },
  [AttestationStatus.Stale]: { className: 'stale', icon: 'triangle-alert' },
  [AttestationStatus.Revoked]: { className: 'revoked', icon: 'slash-circle' },
  [AttestationStatus.Expired]: { className: 'expired', icon: 'clock' },
  [AttestationStatus.ProgramClosed]: { className: 'closed', icon: 'square-x' },
};

export type StatusBadgeProps = {
  status: AttestationStatus;
  size?: 'sm' | 'md' | 'lg';
  /** Plays the one short transition that marks a live status change. */
  flipped?: boolean;
};

export function StatusBadge({ status, size = 'md', flipped = false }: StatusBadgeProps) {
  const { className, icon } = STATUS_STYLES[status];
  const iconSize = size === 'lg' ? 22 : size === 'sm' ? 13 : 15;
  return (
    <span
      className={[styles.badge, styles[size], styles[className], flipped ? styles.flipped : '']
        .filter(Boolean)
        .join(' ')}
      data-status={statusLabel(status)}
    >
      <Icon name={icon} size={iconSize} />
      {statusLabel(status)}
    </span>
  );
}
