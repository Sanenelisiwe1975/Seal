import type { SVGProps } from 'react';

/**
 * The complete icon set. Every glyph is 24x24, 1.5 stroke, currentColor, and earns its place by
 * carrying meaning a word cannot (a status shape, a copy affordance, an outbound link).
 */
export type IconName =
  | 'check-circle'
  | 'triangle-alert'
  | 'slash-circle'
  | 'clock'
  | 'square-x'
  | 'copy'
  | 'check'
  | 'external'
  | 'lock'
  | 'unlock'
  | 'arrow-right'
  | 'search'
  | 'sun'
  | 'moon'
  | 'wallet'
  | 'file-text';

const PATHS: Record<IconName, string> = {
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 12.2l2.4 2.4 4.6-4.9',
  'triangle-alert': 'M12 4.5 2.8 20h18.4L12 4.5ZM12 10v4.2M12 17.1v.01',
  'slash-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 18.4 18.4 5.6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.4V12l3.4 2',
  'square-x': 'M4.5 4.5h15v15h-15zM9 9l6 6M15 9l-6 6',
  copy: 'M9 9V5.5h9.5V15H15M5.5 9H15v9.5H5.5z',
  check: 'M4.5 12.5 9.5 17.5 19.5 7',
  external: 'M14 5h5v5M19 5l-8 8M18 14.5V19H5V6h4.5',
  lock: 'M6.5 11h11v8.5h-11zM9 11V8a3 3 0 0 1 6 0v3',
  unlock: 'M6.5 11h11v8.5h-11zM9 11V8a3 3 0 0 1 5.8-1.1',
  'arrow-right': 'M4.5 12h14M13 6.5 18.5 12 13 17.5',
  search: 'M10.8 17.5a6.8 6.8 0 1 0 0-13.5 6.8 6.8 0 0 0 0 13.5ZM16 16l4 4',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2.5V4M12 20v1.5M4.2 4.2l1.1 1.1M18.7 18.7l1.1 1.1M2.5 12H4M20 12h1.5M4.2 19.8l1.1-1.1M18.7 5.3l1.1-1.1',
  moon: 'M20 14.3A8.5 8.5 0 0 1 9.7 4 8.5 8.5 0 1 0 20 14.3Z',
  wallet: 'M3.5 7.5h17v12h-17zM3.5 7.5 16 4v3.5M16 13.5h2',
  'file-text': 'M6 3.5h7l5 5v12H6zM13 3.5v5h5M9 13h6M9 16.5h6',
};

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> & {
  name: IconName;
  size?: number;
};

export function Icon({ name, size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
