import { cx } from '@/lib/format'

/** An open, hand-drawn Q: the end of the line becomes a way out. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={cx('logo-mark size-9', className)}>
      <path
        className="logo-stroke"
        d="M34.8 32.7C39.6 27.3 39.1 17.6 33.8 12.4C28.1 6.7 18 7.8 12.8 13.5C7.5 19.3 8.4 29.5 14.6 34.1C20.1 38.2 27.6 36.2 30.9 31.6C33.7 27.7 33.2 21.8 29.5 19.4C26.3 17.3 22.1 18.8 21.1 22C19.2 28.1 27.9 37.9 38.6 39.1"
        stroke="currentColor"
        strokeWidth="5.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Logo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="font-display text-[1.65rem] leading-none tracking-[-0.06em] text-ink">queue</span>
      {subtitle ? <span className="ml-1 text-sm text-muted">{subtitle}</span> : null}
    </span>
  )
}
