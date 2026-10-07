import { useId, type ReactNode } from 'react';
import styles from './Tooltip.module.css';

export type TooltipProps = {
  /** Shown on hover and keyboard focus, and read out via `aria-describedby`. */
  label: ReactNode;
  children: ReactNode;
  placement?: 'top' | 'bottom';
  mono?: boolean;
};

/**
 * The tip stays in the DOM so assistive technology can reach it through `aria-describedby`;
 * CSS alone shows and hides it. The child must accept `aria-describedby`.
 */
export function Tooltip({ label, children, placement = 'top', mono = false }: TooltipProps) {
  const id = useId();
  return (
    <span className={styles.wrapper}>
      <span aria-describedby={id} className={styles.target}>
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className={`${styles.tip} ${styles[placement]} ${mono ? styles.mono : ''}`}
      >
        {label}
      </span>
    </span>
  );
}
