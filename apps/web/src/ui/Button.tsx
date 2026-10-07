import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], block ? styles.block : '', className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...props} />;
}
