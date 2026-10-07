import { useCallback, useEffect, useRef, useState } from 'react';

const CONFIRMATION_MS = 1200;

/** Copy-on-click with a brief confirmation. Falls back silently when the clipboard is unavailable. */
export function useCopy(value: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timeout.current), []);

  const copy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        clearTimeout(timeout.current);
        timeout.current = setTimeout(() => setCopied(false), CONFIRMATION_MS);
      })
      .catch(() => setCopied(false));
  }, [value]);

  return { copied, copy };
}
