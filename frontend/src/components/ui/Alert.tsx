import type { ReactNode } from 'react'
import { cx } from '@/lib/format'

type Kind = 'error' | 'info' | 'success' | 'warn'

const KINDS: Record<Kind, string> = {
  error: 'bg-danger-soft text-danger border-danger/20',
  info: 'bg-raised text-muted border-line',
  success: 'bg-sage-soft text-sage border-sage/20',
  warn: 'bg-warn-soft text-warn border-warn/20',
}

export function Alert({ kind = 'info', children }: { kind?: Kind; children: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : undefined} className={cx('rounded-xl border px-4 py-3 text-sm', KINDS[kind])}>
      {children}
    </div>
  )
}
