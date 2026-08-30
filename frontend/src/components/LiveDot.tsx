import { cx } from '@/lib/format'

/**
 * Says whether what you are looking at is being pushed to you or merely polled. Worth the pixels:
 * on a screen full of numbers that move on their own, "is this current?" is the first question.
 */
export function LiveDot({ live, className }: { live: boolean; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 text-xs font-medium', className)}
      title={live ? 'Streaming live updates' : 'Stream unavailable — refreshing every few seconds'}
    >
      <span
        aria-hidden
        className={cx('size-1.5 rounded-full', live ? 'bg-sage pulse-live' : 'bg-faint')}
      />
      <span className={live ? 'text-sage' : 'text-faint'}>{live ? 'Live' : 'Reconnecting'}</span>
    </span>
  )
}
