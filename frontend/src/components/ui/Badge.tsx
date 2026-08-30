import type { ReactNode } from 'react'
import { cx } from '@/lib/format'
import type { Tone } from '@/lib/format'

const TONES: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand',
  sage: 'bg-sage-soft text-sage',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-raised text-muted',
}

export function Badge({
  tone = 'neutral',
  children,
  dot = false,
}: {
  tone?: Tone
  children: ReactNode
  dot?: boolean
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        TONES[tone],
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  )
}
