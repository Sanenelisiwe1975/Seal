import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Field.module.css';

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & {
  label: string;
  /** Shown inline beneath the field, next to the input it belongs to. Never a toast. */
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
  mono?: boolean;
};

export function Field({ label, error, hint, optional = false, mono = false, ...props }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {optional ? <span className={styles.optional}>optional</span> : null}
      </div>
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        className={`${styles.input} ${mono ? styles.mono : ''} ${error ? styles.invalid : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {error ? (
        <p className={styles.error} id={errorId}>
          <Icon name="triangle-alert" size={13} />
          {error}
        </p>
      ) : null}
    </div>
  );
}
