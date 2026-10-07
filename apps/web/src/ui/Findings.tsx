import type { Findings as FindingsType } from '@seal/client';
import styles from './Findings.module.css';

const SEVERITIES = [
  { key: 'critical', short: 'C', className: 'critical' },
  { key: 'high', short: 'H', className: 'high' },
  { key: 'medium', short: 'M', className: 'medium' },
  { key: 'low', short: 'L', className: 'low' },
  { key: 'info', short: 'I', className: 'info' },
] as const;

export type FindingsProps = {
  findings: FindingsType;
  /** Hides severities with no findings, for dense table rows. */
  compact?: boolean;
};

/** Findings by severity. The letter carries the severity, so the colour is never the only signal. */
export function Findings({ findings, compact = false }: FindingsProps) {
  const shown = SEVERITIES.filter(({ key }) => !compact || findings[key] > 0);

  if (shown.length === 0) {
    return <span className={styles.clean}>No findings</span>;
  }

  return (
    <span className={styles.findings}>
      {shown.map(({ key, short, className }) => (
        <span
          key={key}
          className={`${styles.count} ${styles[className]} ${findings[key] === 0 ? styles.zero : ''}`}
          title={`${findings[key]} ${key}`}
        >
          <span className={styles.severity}>{short}</span>
          <span className={styles.value}>{findings[key]}</span>
        </span>
      ))}
    </span>
  );
}

export function totalFindings(findings: FindingsType): number {
  return findings.critical + findings.high + findings.medium + findings.low + findings.info;
}
