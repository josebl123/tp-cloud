'use client'

import { cx } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

/**
 * Says whether what you are looking at is being pushed to you or merely polled. Worth the pixels:
 * on a screen full of numbers that move on their own, "is this current?" is the first question.
 */
export function LiveDot({ live, className }: { live: boolean; className?: string }) {
  const { t } = useI18n()

  return (
    <span
      className={cx('inline-flex items-center gap-1.5 text-xs font-medium', className)}
      title={live ? t('common.liveTitle') : t('common.offlineTitle')}
    >
      <span
        aria-hidden
        className={cx('size-1.5 rounded-full', live ? 'bg-sage pulse-live' : 'bg-faint')}
      />
      <span className={live ? 'text-sage' : 'text-faint'}>
        {live ? t('common.live') : t('common.reconnecting')}
      </span>
    </span>
  )
}
