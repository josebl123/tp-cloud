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
      setActionError(cause instanceof ApiError ? cause.message : 'Something went wrong.')
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

  if (queueId === null) return <Alert kind="error">No queue selected.</Alert>
  if (loading && !board) return <PageLoader label="Loading the board" />
  if (error && !board) return <Alert kind="error">{error.message}</Alert>
  if (!board) return <PageLoader />

  const { queue } = board
  const closed = queue.status === 'CLOSED'

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/panel" className="text-sm text-muted hover:text-ink">
            ← All queues
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight">{queue.name}</h1>
            <Badge tone={queueStatusTone(queue.status)} dot>
              {queueStatusLabel(queue.status)}
            </Badge>
            <LiveDot live={live} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {queue.status === 'OPEN' ? (
            <Button variant="secondary" size="sm" onClick={() => setQueueStatus('PAUSED')}>
              Pause
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setQueueStatus('OPEN')}>
              {closed ? 'Reopen' : 'Resume'}
            </Button>
          )}
          {!closed ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirmClose(true)}>
              Close
            </Button>
          ) : null}
          <Link href={`/panel/queue/qr?id=${queue.id}`}>
            <Button variant="secondary" size="sm">
              QR
            </Button>
          </Link>
          <Link href={`/panel/queue/settings?id=${queue.id}`}>
            <Button variant="secondary" size="sm">
              Settings
            </Button>
          </Link>
        </div>
      </header>

      {queue.status === 'PAUSED' ? (
        <Alert kind="warn">
          Paused — nobody new can join, but you can keep working through the people already in line.
        </Alert>
      ) : null}
      {closed ? <Alert kind="info">This queue is closed. Reopen it to start taking people again.</Alert> : null}
      {actionError ? <Alert kind="error">{actionError}</Alert> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting" value={board.waitingCount} emphasis />
        <Stat label="Being served" value={board.inServiceCount} />
        <Stat
          label="Average service"
          value={`${board.averageServiceMinutes} min`}
          hint={board.usingDefaultServiceTime ? 'configured estimate' : 'measured'}
        />
        <Stat label="Wait for a new arrival" value={formatWaitNeutral(board.estimatedWaitMinutesForNewEntry)} />
      </div>

      <Button size="lg" block onClick={callNext} loading={calling} disabled={closed || board.waitingCount === 0}>
        {board.waitingCount === 0 ? 'Nobody waiting' : 'Call next customer'}
      </Button>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
            Now serving{' '}
            <span className="text-muted tnum">{board.inServiceCount > 0 ? board.inServiceCount : ''}</span>
          </h2>
          {board.inService.length === 0 ? (
            <EmptyState title="Nobody called yet" description="Call the next customer to get started." />
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
            In line <span className="text-muted tnum">{board.waitingCount > 0 ? board.waitingCount : ''}</span>
          </h2>
          {board.waiting.length === 0 ? (
            <EmptyState title="The line is empty" description="New arrivals show up here the moment they scan." />
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
          <span>Recent activity</span>
          <span className={cx('text-faint transition-transform', showActivity && 'rotate-180')} aria-hidden>
            ▾
          </span>
        </button>
        {showActivity ? (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {events.length === 0 ? (
              <li className="px-4 py-3 text-sm text-faint">Nothing recorded yet.</li>
            ) : (
              events.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
                  <span>
                    {eventLabel(event.type)}
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
        title="Close this queue?"
        description={
          board.waitingCount + board.inServiceCount > 0
            ? `${board.waitingCount + board.inServiceCount} people are still in this queue. Closing it releases their places and notifies them.`
            : 'Nobody can join a closed queue until you reopen it.'
        }
        confirmLabel="Close queue"
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
  const remaining = useTicker(entry.graceSecondsRemaining, entry.calledAt)
  const expiring = remaining !== null && remaining <= 30

  return (
    <Card className={cx('border-l-4', entry.status === 'CALLED' ? 'border-l-brand' : 'border-l-warn')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-semibold tnum">#{entry.ticketNumber}</span>
            <Badge tone={entryStatusTone(entry.status)}>{entryStatusLabel(entry.status)}</Badge>
          </div>
          <p className="mt-1 truncate text-lg">{entry.customerName}</p>
          <p className="mt-0.5 text-sm text-muted">
            {entry.partySize ? `Party of ${entry.partySize} · ` : ''}
            {entry.customerPhone ?? entry.customerEmail}
          </p>
        </div>

        {remaining !== null ? (
          <div className={cx('text-right', expiring ? 'text-danger' : 'text-muted')}>
            <div className="font-display text-2xl font-semibold tnum">{formatCountdown(remaining)}</div>
            <div className="text-xs">grace left</div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {entry.status === 'CALLED' ? (
          <Button size="sm" onClick={() => onStatus('SERVING')} loading={busy}>
            They arrived
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => onStatus('SERVED')} disabled={busy}>
          Done
        </Button>
        {entry.status === 'CALLED' ? (
          <Button size="sm" variant="ghost" onClick={() => onStatus('NO_SHOW')} disabled={busy}>
            No show
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => onStatus('WAITING')} disabled={busy}>
          Put back
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
          #{entry.ticketNumber} · waiting {formatSince(entry.joinedAt)}
          {entry.noShowCount > 0 ? ` · ${entry.noShowCount} no-show` : ''}
        </p>
      </div>

      <span className="hidden shrink-0 text-sm text-muted tnum sm:block">
        {formatWaitNeutral(entry.estimatedWaitMinutes)}
      </span>

      <div className="flex shrink-0 gap-1">
        <Button size="sm" onClick={() => onStatus('CALLED')} loading={busy} disabled={disabled}>
          Call
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onStatus('LEFT')} disabled={busy}>
          Remove
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
