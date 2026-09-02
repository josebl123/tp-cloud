import type { EntryStatus, EventType, NotificationType, QueueStatus } from './types'

export type Tone = 'brand' | 'sage' | 'warn' | 'danger' | 'neutral'

/** Waiting time as a customer would say it out loud. */
export function formatWait(minutes: number | undefined | null): string {
  if (minutes === undefined || minutes === null) return '—'
  if (minutes <= 0) return "You're next"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/**
 * Same number, staff phrasing. The customer-facing copy addresses the reader ("You're next"), which
 * is wrong in a column describing someone who has not arrived yet.
 */
export function formatWaitNeutral(minutes: number | undefined | null): string {
  if (minutes === undefined || minutes === null) return '—'
  if (minutes <= 0) return 'No wait'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** Compact form for dense staff tables. */
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

export function formatSince(iso: string | undefined): string {
  if (!iso) return '—'
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

export function entryStatusLabel(status: EntryStatus): string {
  switch (status) {
    case 'WAITING':
      return 'Waiting'
    case 'CALLED':
      return 'Called'
    case 'SERVING':
      return 'Being served'
    case 'SERVED':
      return 'Served'
    case 'LEFT':
      return 'Left'
    case 'NO_SHOW':
      return 'No show'
  }
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

export function queueStatusLabel(status: QueueStatus): string {
  switch (status) {
    case 'OPEN':
      return 'Open'
    case 'PAUSED':
      return 'Paused'
    case 'CLOSED':
      return 'Closed'
  }
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

export function eventLabel(type: EventType): string {
  switch (type) {
    case 'QUEUE_CREATED':
      return 'Queue created'
    case 'QUEUE_UPDATED':
      return 'Settings updated'
    case 'QUEUE_STATUS_CHANGED':
      return 'Status changed'
    case 'QUEUE_DELETED':
      return 'Queue deleted'
    case 'QUEUE_ARCHIVED':
      return 'Queue archived'
    case 'ENTRY_JOINED':
      return 'Joined the queue'
    case 'ENTRY_CALLED':
      return 'Called'
    case 'ENTRY_SERVING_STARTED':
      return 'Started being served'
    case 'ENTRY_SERVED':
      return 'Served'
    case 'ENTRY_LEFT':
      return 'Left the queue'
    case 'ENTRY_NO_SHOW':
      return 'Marked as no show'
    case 'ENTRY_REQUEUED':
      return 'Put back in line'
    case 'NOTIFICATION_SENT':
      return 'Notification sent'
    case 'NOTIFICATION_QUEUED':
      return 'Notification queued'
    case 'NOTIFICATION_FAILED':
      return 'Notification failed'
  }
}

export function notificationLabel(type: NotificationType): string {
  switch (type) {
    case 'TICKET_CREATED':
      return 'Ticket link sent'
    case 'APPROACHING_POSITION':
      return 'Almost your turn'
    case 'APPROACHING_TIME':
      return 'Time reminder'
    case 'YOUR_TURN':
      return "It's your turn"
    case 'NO_SHOW':
      return 'Missed your turn'
    case 'QUEUE_CLOSED':
      return 'Queue closed'
  }
}

/** Joins class names, dropping anything falsy. */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}
