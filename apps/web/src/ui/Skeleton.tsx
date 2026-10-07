import styles from './Skeleton.module.css';

export type SkeletonProps = {
  /** CSS width, e.g. `12ch` for a slot or `18ch` for a truncated address. */
  width?: string;
  height?: string;
};

/** A placeholder shaped like the content it stands in for, sized in the caller's own units. */
export function Skeleton({ width = '100%', height = '1em' }: SkeletonProps) {
  return <span className={styles.skeleton} style={{ width, height }} aria-hidden="true" />;
}
