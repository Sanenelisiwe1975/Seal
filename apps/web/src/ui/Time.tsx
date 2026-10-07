import { formatRelativeTime, formatUtc } from '../lib/format';
import { Tooltip } from './Tooltip';

export type TimeProps = { unix: bigint | number };

/** Relative by default, with the absolute UTC timestamp on hover and in the title attribute. */
export function Time({ unix }: TimeProps) {
  const absolute = formatUtc(unix);
  return (
    <Tooltip label={absolute}>
      <time dateTime={new Date(Number(unix) * 1000).toISOString()}>{formatRelativeTime(unix)}</time>
    </Tooltip>
  );
}
