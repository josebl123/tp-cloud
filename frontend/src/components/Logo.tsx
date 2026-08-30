import { cx } from '@/lib/format'

/**
 * The mark is the letter Q built as a queue: a ring of people waiting, and the tail is the one
 * stepping out of it.
 *
 * The tail deliberately starts *inside* the ring and stops just past it. A tail that starts outside
 * a thin ring reads as a magnifying glass, which is the wrong product entirely.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={cx('size-8', className)}>
      <circle cx="14.5" cy="14.5" r="9" stroke="currentColor" strokeWidth="3.25" />
      <path
        d="M16.5 16.5 L23.5 23.5"
        stroke="var(--color-brand)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Logo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <LogoMark />
      {subtitle ? <span className="text-sm text-muted">{subtitle}</span> : null}
      <span className="sr-only">Q</span>
    </span>
  )
}
