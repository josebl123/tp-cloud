import type { ReactNode } from 'react'
import { LogoMark } from '@/components/Logo'

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-surface/50 px-6 py-14 text-center">
      <LogoMark className="mb-4 size-10" />
      <p className="font-display text-xl tracking-tight">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
