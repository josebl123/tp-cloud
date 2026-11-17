'use client'

import { useI18n } from '@/lib/i18n'
import { LogoMark } from '@/components/Logo'

export function PageLoader({ label }: { label?: string }) {
  const { t } = useI18n()

  return (
    <div role="status" className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-muted">
      <span className="loading-mark"><LogoMark className="size-12" /></span>
      <p className="text-sm">{label ?? t('common.loading')}</p>
    </div>
  )
}
