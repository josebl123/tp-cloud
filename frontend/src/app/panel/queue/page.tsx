'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '@/lib/api'
import {
  cx,
  entryStatusLabel,
  entryStatusTone,
  eventLabel,
  formatClock,
  formatCountdown,
  formatSince,
  formatWaitNeutral,
  queueStatusLabel,
  queueStatusTone,
} from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { getToken } from '@/lib/session'
import { useLiveResource } from '@/lib/useLiveResource'
import { useQueryParam } from '@/lib/usePathSegment'
import type { EntryStatus, EntryView, QueueEventView, QueueSnapshot, QueueStatus } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { LiveDot } from '@/components/LiveDot'
import { PageLoader } from '@/components/PageLoader'
import { Stat } from '@/components/Stat'

/**
 * Functionality 4 — the board the staff actually work from.
 *
 * Everything here is driven by the queue's SSE stream, so two people working the same line see the
 * same thing without refreshing. Actions are optimistic only in appearance: the button locks, the
 * server decides, and the stream delivers the truth.
 */
export default function QueueBoardPage() {
  const { t } = useI18n()
  const queueId = useQueryParam('id')
  const [token, setTokenState] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyEntry, setBusyEntry] = useState<string | null>(null)
  const [calling, setCalling] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [events, setEvents] = useState<QueueEventView[]>([])
  const [showActivity, setShowActivity] = useState(false)

  useEffect(() => setTokenState(getToken()), [])

  const load = useCallback(
    (signal: AbortSignal) => api.queues.board(queueId as string, signal),
    [queueId],
  )

  const { data: board, error, live, loading, refresh } = useLiveResource<QueueSnapshot>({
    url: queueId && token ? api.streams.queue(queueId, token) : null,
    eventName: 'queue.updated',
    load,
    enabled: Boolean(queueId),
  })

  useEffect(() => {
    if (!queueId || !showActivity) return
    api.queues.events(queueId, 30).then(setEvents, () => setEvents([]))
  }, [queueId, showActivity, board?.generatedAt])

  const run = async (task: () => Promise<unknown>, entryId?: string) => {
    setActionError(null)
    if (entryId) setBusyEntry(entryId)
    try {
      await task()
      refresh()
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : t('common.somethingWrong'))
    } finally {
      setBusyEntry(null)
      setCalling(false)
    }
  }

  const callNext = () => {
    setCalling(true)
    void run(() => api.queues.call(queueId as string))
  }

  const setEntryStatus = (entry: EntryView, status: EntryStatus) =>
    void run(() => api.entries.setStatus(entry.id, status), entry.id)

  const setQueueStatus = (status: QueueStatus) => void run(() => api.queues.setStatus(queueId as string, status))

  if (queueId === null) return <Alert kind="error">{t('board.noQueueSelected')}</Alert>
  if (loading && !board) return <PageLoader label={t('board.loading')} />
  if (error && !board) return <Alert kind="error">{error.message}</Alert>
  if (!board) return <PageLoader />

  const { queue } = board
  const closed = queue.status === 'CLOSED'

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/panel" className="text-sm text-muted hover:text-ink">
            ← {t('board.allQueues')}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight">{queue.name}</h1>
            <Badge tone={queueStatusTone(queue.status)} dot>
              {queueStatusLabel(t, queue.status)}
            </Badge>
            <LiveDot live={live} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {queue.status === 'OPEN' ? (
            <Button variant="secondary" size="sm" onClick={() => setQueueStatus('PAUSED')}>
              {t('board.pause')}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setQueueStatus('OPEN')}>
              {closed ? t('board.reopen') : t('board.resume')}
            </Button>
          )}
          {!closed ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirmClose(true)}>
              {t('board.close')}
            </Button>
          ) : null}
          <Link href={`/panel/queue/qr?id=${queue.id}`}>
            <Button variant="secondary" size="sm">
              {t('common.qr')}
            </Button>
          </Link>
          <Link href={`/panel/queue/settings?id=${queue.id}`}>
            <Button variant="secondary" size="sm">
              {t('common.settings')}
            </Button>
          </Link>
        </div>
      </header>

      {queue.status === 'PAUSED' ? (
        <Alert kind="warn">{t('board.pausedNotice')}</Alert>
      ) : null}
      {closed ? <Alert kind="info">{t('board.closedNotice')}</Alert> : null}
      {actionError ? <Alert kind="error">{actionError}</Alert> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('board.statWaiting')} value={board.waitingCount} emphasis />
        <Stat label={t('board.statBeingServed')} value={board.inServiceCount} />
        <Stat
          label={t('board.statAverageService')}
          value={`${board.averageServiceMinutes} min`}
          hint={board.usingDefaultServiceTime ? t('board.configuredEstimate') : t('board.measured')}
        />
        <Stat
          label={t('board.statNewArrival')}
          value={formatWaitNeutral(t, board.estimatedWaitMinutesForNewEntry)}
        />
      </div>

      <Button size="lg" block onClick={callNext} loading={calling} disabled={closed || board.waitingCount === 0}>
        {board.waitingCount === 0 ? t('board.nobodyWaiting') : t('board.callNext')}
      </Button>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
            {t('board.nowServing')}{' '}
            <span className="text-muted tnum">{board.inServiceCount > 0 ? board.inServiceCount : ''}</span>
          </h2>
          {board.inService.length === 0 ? (
            <EmptyState title={t('board.nobodyCalledTitle')} description={t('board.nobodyCalledBody')} />
          ) : (
            <div className="space-y-3">
              {board.inService.map((entry) => (
                <ServingCard
                  key={entry.id}
                  entry={entry}
                  busy={busyEntry === entry.id}
                  onStatus={(status) => setEntryStatus(entry, status)}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
            {t('board.inLine')}{' '}
            <span className="text-muted tnum">{board.waitingCount > 0 ? board.waitingCount : ''}</span>
          </h2>
          {board.waiting.length === 0 ? (
            <EmptyState title={t('board.lineEmptyTitle')} description={t('board.lineEmptyBody')} />
          ) : (
            <ol className="space-y-2">
              {board.waiting.map((entry) => (
                <WaitingRow
                  key={entry.id}
                  entry={entry}
                  disabled={closed}
                  busy={busyEntry === entry.id}
                  onStatus={(status) => setEntryStatus(entry, status)}
                />
              ))}
            </ol>
          )}
        </section>
      </div>

      <section>
        <button
          type="button"
          onClick={() => setShowActivity((value) => !value)}
          className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-raised"
          aria-expanded={showActivity}
        >
          <span>{t('board.recentActivity')}</span>
          <span className={cx('text-faint transition-transform', showActivity && 'rotate-180')} aria-hidden>
            ▾
          </span>
        </button>
        {showActivity ? (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {events.length === 0 ? (
              <li className="px-4 py-3 text-sm text-faint">{t('board.noActivity')}</li>
            ) : (
              events.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
                  <span>
                    {eventLabel(t, event.type)}
                    {event.detail ? <span className="ml-2 text-xs text-faint">{event.detail}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-faint tnum">{formatClock(event.occurredAt)}</span>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </section>

      <ConfirmDialog
        open={confirmClose}
        title={t('board.confirmCloseTitle')}
        description={
          board.waitingCount + board.inServiceCount > 0
            ? t('board.confirmCloseWithPeople', {
                count: board.waitingCount + board.inServiceCount,
              })
            : t('board.confirmCloseEmpty')
        }
        confirmLabel={t('board.confirmCloseAction')}
        destructive
        onConfirm={() => {
          setConfirmClose(false)
          setQueueStatus('CLOSED')
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  )
}

function ServingCard({
  entry,
  busy,
  onStatus,
}: {
  entry: EntryView
  busy: boolean
  onStatus: (status: EntryStatus) => void
}) {
  const { t } = useI18n()
  const remaining = useTicker(entry.graceSecondsRemaining, entry.calledAt)
  const expiring = remaining !== null && remaining <= 30

  return (
    <Card className={cx('border-l-4', entry.status === 'CALLED' ? 'border-l-brand' : 'border-l-warn')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-semibold tnum">#{entry.ticketNumber}</span>
            <Badge tone={entryStatusTone(entry.status)}>{entryStatusLabel(t, entry.status)}</Badge>
          </div>
          <p className="mt-1 truncate text-lg">{entry.customerName}</p>
          <p className="mt-0.5 text-sm text-muted">
            {entry.partySize ? `${t('board.partyOf', { count: entry.partySize })} · ` : ''}
            {entry.customerPhone ?? entry.customerEmail}
          </p>
        </div>

        {remaining !== null ? (
          <div className={cx('text-right', expiring ? 'text-danger' : 'text-muted')}>
            <div className="font-display text-2xl font-semibold tnum">{formatCountdown(remaining)}</div>
            <div className="text-xs">{t('board.graceLeft')}</div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {entry.status === 'CALLED' ? (
          <Button size="sm" onClick={() => onStatus('SERVING')} loading={busy}>
            {t('board.theyArrived')}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => onStatus('SERVED')} disabled={busy}>
          {t('board.done')}
        </Button>
        {entry.status === 'CALLED' ? (
          <Button size="sm" variant="ghost" onClick={() => onStatus('NO_SHOW')} disabled={busy}>
            {t('board.noShow')}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => onStatus('WAITING')} disabled={busy}>
          {t('board.putBack')}
        </Button>
      </div>
    </Card>
  )
}

function WaitingRow({
  entry,
  disabled,
  busy,
  onStatus,
}: {
  entry: EntryView
  disabled: boolean
  busy: boolean
  onStatus: (status: EntryStatus) => void
}) {
  const { t } = useI18n()

  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised font-display text-base font-semibold tnum">
        {entry.position}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {entry.customerName}
          {entry.partySize ? <span className="ml-1.5 text-sm text-muted">· {entry.partySize}</span> : null}
        </p>
        <p className="text-xs text-muted tnum">
          #{entry.ticketNumber} · {t('board.waitingFor', { since: formatSince(t, entry.joinedAt) })}
          {entry.noShowCount > 0 ? ` · ${t('board.noShowCount', { count: entry.noShowCount })}` : ''}
        </p>
      </div>

      <span className="hidden shrink-0 text-sm text-muted tnum sm:block">
        {formatWaitNeutral(t, entry.estimatedWaitMinutes)}
      </span>

      <div className="flex shrink-0 gap-1">
        <Button size="sm" onClick={() => onStatus('CALLED')} loading={busy} disabled={disabled}>
          {t('board.call')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onStatus('LEFT')} disabled={busy}>
          {t('board.remove')}
        </Button>
      </div>
    </li>
  )
}

/** Local one-second tick so a grace countdown never looks stuck between server pushes. */
function useTicker(seconds: number | undefined, resetKey: string | undefined): number | null {
  const [value, setValue] = useState<number | null>(seconds ?? null)

  useEffect(() => {
    setValue(seconds ?? null)
  }, [seconds, resetKey])

  useEffect(() => {
    if (value === null) return
    const timer = window.setInterval(() => {
      setValue((current) => (current === null ? null : Math.max(0, current - 1)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [value === null])

  return value
}
