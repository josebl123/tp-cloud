import type { ReactNode } from 'react'
import { cx } from '@/lib/format'

export function Stat({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  emphasis?: boolean
}) {
  return (
    <div
      className={cx(
        'rounded-xl border px-4 py-3.5',
        emphasis ? 'border-brand/20 bg-brand-soft' : 'border-line bg-raised/60',
      )}
    >
      <div className={cx('text-xs font-medium', emphasis ? 'text-brand' : 'text-muted')}>{label}</div>
      <div
        className={cx(
          'mt-1 font-display text-2xl font-semibold tnum tracking-tight',
          emphasis && 'text-brand',
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-faint">{hint}</div> : null}
    </div>
  )
}
