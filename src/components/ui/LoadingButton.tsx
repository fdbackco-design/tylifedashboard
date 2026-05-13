'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type LoadingButtonProps = {
  isLoading?: boolean;
  loadingText?: string;
  children: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>;

export default function LoadingButton({
  isLoading = false,
  loadingText,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}: LoadingButtonProps) {
  const busy = Boolean(isLoading);
  return (
    <button
      type={type}
      className={className}
      disabled={Boolean(disabled) || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? (
        <span className="inline-flex items-center justify-center gap-1.5">
          <span
            className="inline-block size-3.5 shrink-0 border-2 border-current border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
          <span>{loadingText ?? children}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
