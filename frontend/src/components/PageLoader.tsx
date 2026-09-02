'use client'

import { useI18n } from '@/lib/i18n'

export function PageLoader({ label }: { label?: string }) {
  const { t } = useI18n()

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted">
      <span
        aria-hidden
        className="size-7 animate-spin rounded-full border-2 border-line-strong border-t-brand"
      />
      <p className="text-sm">{label ?? t('common.loading')}</p>
    </div>
  )
}
