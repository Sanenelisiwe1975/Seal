import { AttestationStatus } from '@seal/client';

/** `Abcd…wxyz` — enough of both ends to recognise an address, never enough to confuse two. */
export function truncateAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** Slots are long. Thin spaces group them without implying a decimal separator. */
export function formatSlot(slot: bigint | number): string {
  return slot.toLocaleString('en-US').replaceAll(',', ' ');
}

export function formatCount(value: number | bigint): string {
  return value.toLocaleString('en-US');
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

const relativeFormatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto', style: 'short' });

/** "4 min ago". The absolute UTC timestamp belongs in a tooltip next to it. */
export function formatRelativeTime(unix: bigint | number, now: number = Date.now()): string {
  const seconds = Number(unix) - Math.floor(now / 1000);
  const magnitude = Math.abs(seconds);
  if (magnitude < 45) return 'just now';
  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (magnitude >= unitSeconds) {
      return relativeFormatter.format(Math.round(seconds / unitSeconds), unit);
    }
  }
  return relativeFormatter.format(Math.round(seconds), 'second');
}

export function formatUtc(unix: bigint | number): string {
  const date = new Date(Number(unix) * 1000);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

export const STATUS_LABELS: Record<AttestationStatus, string> = {
  [AttestationStatus.Valid]: 'Valid',
  [AttestationStatus.Stale]: 'Stale',
  [AttestationStatus.Revoked]: 'Revoked',
  [AttestationStatus.Expired]: 'Expired',
  [AttestationStatus.ProgramClosed]: 'Program closed',
};

export function statusLabel(status: AttestationStatus): string {
  return STATUS_LABELS[status];
}

/** The one-line reason behind a status, written for someone deciding whether to trust the code. */
export function statusExplanation(
  status: AttestationStatus,
  context: { auditSlot: bigint; liveSlot: bigint | null; expiresAt: bigint },
): string {
  switch (status) {
    case AttestationStatus.Valid:
      return `The deployed code is the code that was audited (deploy slot ${formatSlot(context.auditSlot)}).`;
    case AttestationStatus.Stale:
      return context.liveSlot === null
        ? 'Code changed since the audit.'
        : `Code changed since audit (deploy slot ${formatSlot(context.auditSlot)} → ${formatSlot(context.liveSlot)}).`;
    case AttestationStatus.Revoked:
      return 'The issuing auditor withdrew this attestation.';
    case AttestationStatus.Expired:
      return `The attestation lapsed on ${formatUtc(context.expiresAt)}.`;
    case AttestationStatus.ProgramClosed:
      return 'The program has been closed; there is no deployed code to audit.';
  }
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}
