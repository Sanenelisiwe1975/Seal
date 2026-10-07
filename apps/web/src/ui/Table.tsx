import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import styles from './Table.module.css';

export type TableProps = {
  children: ReactNode;
  /** Describes the table for screen readers; shown above it. */
  caption?: ReactNode;
  /** Collapses rows into stacked definition lists under 640px. On by default. */
  stacked?: boolean;
};

export function Table({ children, caption, stacked = true }: TableProps) {
  return (
    <div className={styles.scroll}>
      <table className={`${styles.table} ${stacked ? styles.stacked : ''}`}>
        {caption ? <caption>{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export type CellProps = TdHTMLAttributes<HTMLTableCellElement> & {
  /** Right-aligns with tabular figures, for anything that should line up down the column. */
  numeric?: boolean;
  /** The column name, shown as the term when the row collapses on narrow screens. */
  label?: string;
};

export function Td({ numeric = false, label, className, children, ...props }: CellProps) {
  return (
    <td
      className={[numeric ? styles.numeric : '', className].filter(Boolean).join(' ')}
      data-label={label}
      {...props}
    >
      {children}
    </td>
  );
}

export type HeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean };

export function Th({ numeric = false, className, children, ...props }: HeaderCellProps) {
  return (
    <th
      scope="col"
      className={[numeric ? styles.numeric : '', className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </th>
  );
}
