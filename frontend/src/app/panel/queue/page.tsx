'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useState } from 'react'
import { api } from '@/lib/api'
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
  errorMessage,
} from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { useLiveResource } from '@/lib/useLiveResource'
import { useQueryParam } from '@/lib/useQueryParam'
import type { EntryStatus, EntryView, QueueEventView, QueueSnapshot, QueueStatus } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
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
  const { t, tp } = useI18n()
  const queueId = useQueryParam('id')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyEntry, setBusyEntry] = useState<string | null>(null)
  const [calling, setCalling] = useState(false)
  // Per-lane, so calling from one line does not spin and disable every other line's button.
  const [callingLane, setCallingLane] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [events, setEvents] = useState<QueueEventView[]>([])
  const [pendingStatus, setPendingStatus] = useState<{ entry: EntryView; status: EntryStatus } | null>(null)

  // The timeline is the business's record of its own line: who was called, who was served, who never
  // showed. Handing a notification to the mail queue is our plumbing, and it arrives paired with the
  // delivery a moment later, so showing both put two near-identical rows on every alert.
  const visibleEvents = events.filter((event) => event.type !== 'NOTIFICATION_QUEUED')
  const [showActivity, setShowActivity] = useState(false)
  const [eventsFailed, setEventsFailed] = useState(false)
  const disclosureId = useId()

  const load = useCallback(
    (signal: AbortSignal) => api.queues.board(queueId as string, signal),
    [queueId],
  )

  const socket = useCallback(() => (queueId ? api.realtime.queue(queueId) : Promise.resolve(null)), [queueId])

  const { data: board, error, live, loading, refresh } = useLiveResource<QueueSnapshot>({
    socket,
    eventName: 'queue.updated',
    load,
    enabled: Boolean(queueId),
  })

  useEffect(() => {
    if (!queueId || !showActivity) return
    api.queues.events(queueId, 30).then(
      (loaded) => {
        setEvents(loaded)
        setEventsFailed(false)
      },
      () => setEventsFailed(true),
    )
  }, [queueId, showActivity, board?.generatedAt])

  const run = async (task: () => Promise<unknown>, entryId?: string) => {
    setActionError(null)
    if (entryId) setBusyEntry(entryId)
    try {
      await task()
      refresh()
    } catch (cause) {
      setActionError(errorMessage(t, cause))
    } finally {
      setBusyEntry(null)
      setCalling(false)
      setCallingLane(null)
    }
  }

  const callNext = () => {
    setCalling(true)
    void run(() => api.queues.call(queueId as string))
  }

  const callLane = (laneId: string) => {
    setCallingLane(laneId)
    void run(() => api.queues.call(queueId as string, undefined, laneId))
  }

  const setEntryStatus = (entry: EntryView, status: EntryStatus) =>
    void run(() => api.entries.setStatus(entry.id, status), entry.id)

  // Anything that ends a person's visit gets confirmed. "Done" was the odd one out: it is the most
  // final of the three and it was the only one that fired on a single mis-tap.
  const askStatus = (entry: EntryView, status: EntryStatus) => {
    if (status === 'LEFT' || status === 'NO_SHOW' || status === 'SERVED') {
      setPendingStatus({ entry, status })
    } else {
      setEntryStatus(entry, status)
    }
  }

  const setQueueStatus = (status: QueueStatus) => void run(() => api.queues.setStatus(queueId as string, status))

  if (queueId === null) return <Alert kind="error">{t('board.noQueueSelected')}</Alert>
  if (loading && !board) return <PageLoader label={t('board.loading')} />
  if (error && !board) return <Alert kind="error">{errorMessage(t, error)}</Alert>
  if (!board) return <PageLoader />

  const { queue } = board
  const closed = queue.status === 'CLOSED'
  const allLanes = board.lanes ?? []
  const activeLanes = allLanes.filter((lane) => lane.lane.active)
  const strandedLanes = allLanes.filter(
    (lane) => !lane.lane.active && lane.waiting.length + lane.inService.length > 0,
  )
  const shownLanes = [...activeLanes, ...strandedLanes]

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
          {/* Running the queue is done from the sidebar once there is room for one; see below. */}
          <div className="flex gap-2 xl:hidden">
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
          </div>
          <ButtonLink href={`/panel/queue/qr?id=${queue.id}`} variant="secondary" size="sm">
            {t('common.qr')}
          </ButtonLink>
          <ButtonLink href={`/panel/queue/settings?id=${queue.id}`} variant="secondary" size="sm">
            {t('common.settings')}
          </ButtonLink>
        </div>
      </header>

      <p aria-live="polite" className="sr-only">
        {t('board.updated', { waiting: board.waitingCount, serving: board.inServiceCount })}
      </p>

      {queue.status === 'PAUSED' ? (
        <Alert kind="warn">{t('board.pausedNotice')}</Alert>
      ) : null}
      {closed ? <Alert kind="info">{t('board.closedNotice')}</Alert> : null}
      {actionError ? <Alert kind="error">{actionError}</Alert> : null}

      {/*
        A wide screen was showing the same one-column phone layout stretched across it: the operator
        scrolled past the counts to reach "call next", and scrolled back up to pause the queue. On xl
        those controls move into a column that stays put while the line scrolls beside it. Below xl
        nothing changes, and each control appears exactly once at every width.
      */}
      <div className="xl:grid xl:grid-cols-[18rem_minmax(0,1fr)] xl:items-start xl:gap-8">
        <aside className="hidden xl:block">
          <BoardControlPanel
            board={board}
            closed={closed}
            calling={calling}
            laneCount={shownLanes.length}
            onCall={callNext}
            onStatus={setQueueStatus}
            onClose={() => setConfirmClose(true)}
          />
        </aside>

        <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:hidden">
        <Stat label={t('board.statWaiting')} value={board.waitingCount} emphasis />
        <Stat label={t('board.statBeingServed')} value={board.inServiceCount} />
        <Stat
          label={t('board.statAverageService')}
          value={t('board.minutesUnit', { count: board.averageServiceMinutes })}
          hint={board.usingDefaultServiceTime ? t('board.configuredEstimate') : t('board.measured')}
        />
        <Stat label={t('board.activeLanes')} value={activeLanes.length} />
      </div>

      <Button
        className="xl:hidden"
        size="lg"
        block
        onClick={callNext}
        loading={calling}
        disabled={closed || board.waitingCount === 0}
      >
        {board.waitingCount === 0 ? t('board.nobodyWaiting') : t('board.callNext')}
      </Button>

      {shownLanes.length > 1 ? (
        <div className={cx('grid items-start gap-4 md:grid-cols-2', shownLanes.length > 2 && 'xl:grid-cols-3')}>
          {shownLanes.map((lane) => (
            <Card
              key={lane.lane.id}
              className={cx('min-w-0', !lane.lane.active && 'border-warn/40 bg-warn-soft/30')}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-40">
                  <h2 className="font-display text-lg font-semibold">
                    {lane.lane.name}
                    {!lane.lane.active ? (
                      <span className="ml-2 align-middle">
                        <Badge tone="warn">{t('lane.closedStillWaiting')}</Badge>
                      </span>
                    ) : null}
                  </h2>
                  <p className="text-sm text-muted">
                    {t('lane.range', { min: lane.lane.minPartySize, max: lane.lane.maxPartySize ?? '∞' })}
                    {' · '}
                    {tp('lane.waitingCount', lane.waitingGroups)}
                    {lane.capacityMaximum != null ? (
                      <>
                        {' · '}
                        {t(
                          lane.lane.capacityMode === 'PERSONS'
                            ? 'lane.capacityPersons'
                            : 'lane.capacityGroups',
                          { used: lane.capacityUsed, max: lane.capacityMaximum },
                        )}
                      </>
                    ) : null}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => callLane(lane.lane.id)}
                  loading={callingLane === lane.lane.id}
                  disabled={closed || lane.waiting.length === 0}
                >
                  {t('lane.callNext')}
                </Button>
              </div>

              <div className="mt-4 space-y-2">
                {lane.inService.map((entry) => (
                  <ServingCard
                    key={entry.id}
                    entry={entry}
                    busy={busyEntry === entry.id}
                    onStatus={(status) => askStatus(entry, status)}
                  />
                ))}
                {lane.waiting.length > 0 ? (
                  <ol className="@container space-y-2">
                    {lane.waiting.map((entry) => (
                      <WaitingRow
                        key={entry.id}
                        entry={entry}
                        disabled={closed}
                        busy={busyEntry === entry.id}
                        onStatus={(status) => askStatus(entry, status)}
                      />
                    ))}
                  </ol>
                ) : null}
                {lane.waiting.length === 0 && lane.inService.length === 0 ? (
                  <p className="text-sm text-faint">{t('lane.empty')}</p>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
        <section className="min-w-0">
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
                  onStatus={(status) => askStatus(entry, status)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0">
          <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
            {t('board.inLine')}{' '}
            <span className="text-muted tnum">{board.waitingCount > 0 ? board.waitingCount : ''}</span>
          </h2>
          {board.waiting.length === 0 ? (
            <EmptyState title={t('board.lineEmptyTitle')} description={t('board.lineEmptyBody')} />
          ) : (
            <ol className="@container space-y-2">
              {board.waiting.map((entry) => (
                <WaitingRow
                  key={entry.id}
                  entry={entry}
                  disabled={closed}
                  busy={busyEntry === entry.id}
                  onStatus={(status) => askStatus(entry, status)}
                />
              ))}
            </ol>
          )}
        </section>
        </div>
      )}

      <section>
        <button
          type="button"
          onClick={() => setShowActivity((value) => !value)}
          className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-raised"
          aria-expanded={showActivity}
          aria-controls={disclosureId}
        >
          <span>{t('board.recentActivity')}</span>
          <span className={cx('text-faint transition-transform', showActivity && 'rotate-180')} aria-hidden>
            ▾
          </span>
        </button>
        {showActivity ? (
          <ul
            id={disclosureId}
            className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface"
          >
            {eventsFailed ? (
              <li className="px-4 py-3 text-sm text-danger">{t('board.activityFailed')}</li>
            ) : visibleEvents.length === 0 ? (
              <li className="px-4 py-3 text-sm text-faint">{t('board.noActivity')}</li>
            ) : (
              visibleEvents.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
                  <span>
                    {eventLabel(t, event.type)}
                  </span>
                  <span className="shrink-0 text-xs text-faint tnum">{formatClock(event.occurredAt)}</span>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </section>
        </div>
      </div>

      <ConfirmDialog
        open={pendingStatus !== null}
        title={t(
          pendingStatus?.status === 'NO_SHOW'
            ? 'board.confirmNoShowTitle'
            : pendingStatus?.status === 'SERVED'
              ? 'board.confirmDoneTitle'
              : 'board.confirmRemoveTitle',
          { name: pendingStatus?.entry.customerName ?? '' },
        )}
        description={t(
          pendingStatus?.status === 'NO_SHOW'
            ? 'board.confirmNoShowBody'
            : pendingStatus?.status === 'SERVED'
              ? 'board.confirmDoneBody'
              : 'board.confirmRemoveBody',
        )}
        confirmLabel={t(
          pendingStatus?.status === 'NO_SHOW'
            ? 'board.confirmNoShowAction'
            : pendingStatus?.status === 'SERVED'
              ? 'board.confirmDoneAction'
              : 'board.confirmRemoveAction',
        )}
        destructive={pendingStatus?.status !== 'SERVED'}
        onConfirm={() => {
          if (pendingStatus) setEntryStatus(pendingStatus.entry, pendingStatus.status)
          setPendingStatus(null)
        }}
        onCancel={() => setPendingStatus(null)}
      />

      <ConfirmDialog
        open={confirmClose}
        title={t('board.confirmCloseTitle')}
        description={
          board.waitingCount + board.inServiceCount > 0
            ? tp('board.confirmCloseWithGroups', board.waitingCount + board.inServiceCount)
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

/**
 * The wide-screen control column: the counts that answer "how busy am I", the one button pressed
 * most often, and the two that change the queue's state.
 *
 * <p>`sticky top-24` rather than `top-0`: the staff header is sticky and 64px tall, so a panel
 * pinned to the top of the viewport would slide underneath it.
 *
 * <p>Everything here also exists in the flow above, hidden from xl up. That duplication is the
 * price of one layout serving a phone at the host stand and a monitor in the back office; the
 * alternative is rendering the controls once and moving them with CSS, which loses the DOM order
 * that a screen reader and the tab sequence follow.
 */
function BoardControlPanel({
  board,
  closed,
  calling,
  laneCount,
  onCall,
  onStatus,
  onClose,
}: {
  board: QueueSnapshot
  closed: boolean
  calling: boolean
  laneCount: number
  onCall: () => void
  onStatus: (status: QueueStatus) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const { queue } = board

  return (
    <Card className="sticky top-24 space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t('board.statWaiting')} value={board.waitingCount} emphasis />
        <Stat label={t('board.statBeingServed')} value={board.inServiceCount} />
        <Stat
          label={t('board.statAverageService')}
          value={t('board.minutesUnit', { count: board.averageServiceMinutes })}
          hint={board.usingDefaultServiceTime ? t('board.configuredEstimate') : t('board.measured')}
        />
        <Stat label={t('board.activeLanes')} value={laneCount} />
      </div>

      <Button size="lg" block onClick={onCall} loading={calling} disabled={closed || board.waitingCount === 0}>
        {board.waitingCount === 0 ? t('board.nobodyWaiting') : t('board.callNext')}
      </Button>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        {queue.status === 'OPEN' ? (
          <Button variant="secondary" size="sm" block onClick={() => onStatus('PAUSED')}>
            {t('board.pause')}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" block onClick={() => onStatus('OPEN')}>
            {closed ? t('board.reopen') : t('board.resume')}
          </Button>
        )}
        {!closed ? (
          <Button variant="ghost" size="sm" block onClick={onClose}>
            {t('board.close')}
          </Button>
        ) : null}
      </div>
    </Card>
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
    <Card className={cx('min-w-0 border-l-4', entry.status === 'CALLED' ? 'border-l-brand' : 'border-l-warn')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-semibold tnum">#{entry.ticketNumber}</span>
            <Badge tone={entryStatusTone(entry.status)}>{entryStatusLabel(t, entry.status)}</Badge>
          </div>
          <p className="mt-1 truncate text-lg">{entry.customerName}</p>
          <p className="mt-0.5 text-sm text-muted">
            {entry.partySize ? `${t('board.partyOf', { count: entry.partySize })} · ` : ''}
            {entry.customerEmail ?? entry.customerPhone}
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
  const { t, tp } = useI18n()

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised font-display text-base font-semibold tnum">
        {entry.lanePosition}
      </span>

      <div className="min-w-0 flex-1 basis-36">
        <p className="truncate font-medium">
          {entry.customerName}
          {entry.partySize ? (
            <span className="ml-1.5 text-sm font-normal text-muted">
              · {t('board.partyOf', { count: entry.partySize })}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted tnum">
          #{entry.ticketNumber} · {t('board.waitingFor', { since: formatSince(t, entry.joinedAt) })}
          {entry.noShowCount > 0 ? ` · ${tp('board.noShowCount', entry.noShowCount)}` : ''}
        </p>
      </div>

      <span className="hidden shrink-0 text-sm text-muted tnum @lg:block">
        {formatWaitNeutral(t, entry.estimatedWaitMinutes)}
      </span>

      <div className="flex shrink-0 gap-1 max-sm:w-full max-sm:justify-end">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onStatus('CALLED')}
          loading={busy}
          disabled={disabled}
          aria-label={t('board.callNamed', { name: entry.customerName })}
        >
          {t('board.call')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onStatus('LEFT')}
          disabled={busy}
          aria-label={t('board.removeNamed', { name: entry.customerName })}
        >
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

  // Restart the interval only when the countdown appears or disappears, not on every tick.
  const idle = value === null

  useEffect(() => {
    if (idle) return
    const timer = window.setInterval(() => {
      setValue((current) => (current === null ? null : Math.max(0, current - 1)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [idle])

  return value
}
