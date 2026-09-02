import type { Translate } from './i18n'
import type { EntryStatus, EventType, NotificationType, QueueStatus } from './types'

export type Tone = 'brand' | 'sage' | 'warn' | 'danger' | 'neutral'

/**
 * Formatting helpers.
 *
 * Anything that produces words takes the translate function explicitly rather than reaching for a
 * hook, so these stay plain functions usable from anywhere — including inside `.map()` callbacks and
 * outside React entirely.
 */

/** Waiting time as a customer would say it out loud. */
export function formatWait(t: Translate, minutes: number | undefined | null): string {
  if (minutes === undefined || minutes === null) return t('wait.none')
  if (minutes <= 0) return t('wait.youreNext')
  return spellDuration(t, minutes)
}

/**
 * Same number, staff phrasing. The customer-facing copy addresses the reader ("You're next"), which
 * is wrong in a column describing someone who has not arrived yet.
 */
export function formatWaitNeutral(t: Translate, minutes: number | undefined | null): string {
  if (minutes === undefined || minutes === null) return t('wait.none')
  if (minutes <= 0) return t('wait.noWait')
  return spellDuration(t, minutes)
}

function spellDuration(t: Translate, minutes: number): string {
  if (minutes < 60) return t('wait.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0
    ? t('wait.hours', { count: hours })
    : t('wait.hoursMinutes', { hours, minutes: rest })
}

/** Compact form for dense staff tables. Unit letters read the same in both languages. */
export function formatMinutes(minutes: number | undefined | null): string {
  if (minutes === undefined || minutes === null) return '—'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function formatClock(iso: string | undefined, timeZone?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
}

export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function formatSince(t: Translate, iso: string | undefined): string {
  if (!iso) return '—'
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return t('since.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('since.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('since.hours', { count: hours })
  return t('since.days', { count: Math.floor(hours / 24) })
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

export function entryStatusLabel(t: Translate, status: EntryStatus): string {
  return t(`status.${status}` as never)
}

export function entryStatusTone(status: EntryStatus): Tone {
  switch (status) {
    case 'WAITING':
      return 'neutral'
    case 'CALLED':
      return 'brand'
    case 'SERVING':
      return 'warn'
    case 'SERVED':
      return 'sage'
    case 'LEFT':
      return 'neutral'
    case 'NO_SHOW':
      return 'danger'
  }
}

export function queueStatusLabel(t: Translate, status: QueueStatus): string {
  return t(`queueStatus.${status}` as never)
}

export function queueStatusTone(status: QueueStatus): Tone {
  switch (status) {
    case 'OPEN':
      return 'sage'
    case 'PAUSED':
      return 'warn'
    case 'CLOSED':
      return 'neutral'
  }
}

export function eventLabel(t: Translate, type: EventType): string {
  return t(`event.${type}` as never)
}

export function notificationLabel(t: Translate, type: NotificationType): string {
  return t(`notification.${type}` as never)
}

/** Joins class names, dropping anything falsy. */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}
