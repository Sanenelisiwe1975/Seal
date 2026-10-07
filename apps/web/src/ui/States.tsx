import type { ReactNode } from 'react';
import { describeError } from '../lib/errors';
import { Button } from './Button';
import styles from './States.module.css';

export type EmptyStateProps = {
  /** What is missing. */
  title: string;
  /** What the reader can do about it. */
  children?: ReactNode;
  inline?: boolean;
};

export function EmptyState({ title, children, inline = false }: EmptyStateProps) {
  return (
    <div className={`${styles.state} ${inline ? styles.inline : ''}`}>
      <p className={styles.title}>{title}</p>
      {children ? <div className={styles.body}>{children}</div> : null}
    </div>
  );
}

export type ErrorStateProps = {
  /** What the app was trying to do, e.g. "Could not load attestations for this program." */
  title: string;
  error: unknown;
  onRetry?: () => void;
  inline?: boolean;
};

/** Shows the actual error, decoded where possible, instead of a generic apology. */
export function ErrorState({ title, error, onRetry, inline = false }: ErrorStateProps) {
  const described = describeError(error);
  return (
    <div className={`${styles.state} ${styles.error} ${inline ? styles.inline : ''}`} role="alert">
      <p className={styles.title}>{title}</p>
      <p className={styles.body}>{described.message}</p>
      {described.detail ? <pre className={styles.detail}>{described.detail}</pre> : null}
      {onRetry ? (
        <div className={styles.actions}>
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
