'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { cx, formatClock, formatCountdown, formatWait, notificationLabel } from '@/lib/format'
import { useLiveResource } from '@/lib/useLiveResource'
import { usePathSegment } from '@/lib/usePathSegment'
import type { NotificationView, TicketView } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { LiveDot } from '@/components/LiveDot'
import { LogoMark } from '@/components/Logo'
import { PageLoader } from '@/components/PageLoader'

/**
 * Functionalities 2, 3 and 5 — the screen a customer actually keeps open.
 *
 * Whatever else is on it, one number has to be readable from a pocket-glance away, so the position
 * is set enormous and everything else is deliberately quiet. When the turn arrives the screen stops
 * being an information display and becomes a single instruction.
 */
export default function TicketPage() {
  const token = usePathSegment(1)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [notifications, setNotifications] = useState<NotificationView[]>([])
  const [showUpdates, setShowUpdates] = useState(false)

  const load = useCallback(
    (signal: AbortSignal) => api.publicApi.ticket(token as string, signal),
    [token],
  )

  const { data: ticket, error, live, loading, refresh } = useLiveResource<TicketView>({
    url: token ? api.streams.ticket(token) : null,
    eventName: 'ticket.updated',
    load,
    enabled: Boolean(token),
  })

  useEffect(() => {
    if (!token || !showUpdates) return
    api.publicApi.notifications(token).then(setNotifications, () => setNotifications([]))
  }, [token, showUpdates, ticket?.status])

  const leave = async () => {
    if (!token) return
    setLeaving(true)
    try {
      await api.publicApi.leave(token)
      setLeaveOpen(false)
      refresh()
    } catch {
      setLeaveOpen(false)
    } finally {
      setLeaving(false)
    }
  }

  if (token === null) {
    return <Shell><Alert kind="error">This link is missing a ticket.</Alert></Shell>
  }
  if (loading && !ticket) return <Shell><PageLoader label="Finding your place" /></Shell>
  if (error && !ticket) {
    return (
      <Shell>
        <Alert kind="error">
          {error.status === 404
            ? "We can't find this ticket. It may belong to a queue that has been removed."
            : error.message}
        </Alert>
      </Shell>
    )
  }
  if (!ticket) return <Shell><PageLoader /></Shell>

  return (
    <Shell>
      <header className="animate-in flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted">{ticket.queue.establishmentName}</p>
          <h1 className="mt-0.5 truncate font-display text-2xl font-semibold tracking-tight">
            {ticket.queue.name}
          </h1>
          {ticket.laneName ? <p className="mt-1 text-sm text-muted">Lane: {ticket.laneName}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-muted tnum">
            Ticket #{ticket.ticketNumber}
          </span>
          <LiveDot live={live} />
        </div>
      </header>

      <div className="mt-6">
        {ticket.status === 'CALLED' ? (
          <CalledHero ticket={ticket} />
        ) : ticket.status === 'WAITING' ? (
          <WaitingHero ticket={ticket} />
        ) : (
          <ClosingHero ticket={ticket} />
        )}
      </div>

      {ticket.status === 'WAITING' || ticket.status === 'CALLED' ? (
        <div className="mt-6">
          <Button variant="secondary" block onClick={() => setLeaveOpen(true)}>
            Leave the queue
          </Button>
          <p className="mt-2 text-center text-xs text-faint">
            Letting us know frees your place, so everyone behind you moves up.
          </p>
        </div>
      ) : ticket.status === 'LEFT' || ticket.status === 'NO_SHOW' ? (
        <div className="mt-6">
          <a href={`/q/${ticket.queue.id}/`}>
            <Button block>Join the queue again</Button>
          </a>
        </div>
      ) : null}

      <section className="mt-8">
        <button
          type="button"
          onClick={() => setShowUpdates((value) => !value)}
          className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-raised"
          aria-expanded={showUpdates}
        >
          <span>Updates we sent you</span>
          <span className={cx('text-faint transition-transform', showUpdates && 'rotate-180')} aria-hidden>
            ▾
          </span>
        </button>

        {showUpdates ? (
          <ul className="mt-2 space-y-1.5">
            {notifications.length === 0 ? (
              <li className="px-4 py-3 text-sm text-faint">Nothing yet.</li>
            ) : (
              notifications.map((notification) => (
                <li
                  key={notification.id}
                  className="flex items-baseline justify-between gap-3 rounded-xl bg-raised/70 px-4 py-2.5 text-sm"
                >
                  <span>{notificationLabel(notification.type)}</span>
                  <span className="shrink-0 text-xs text-faint tnum">
                    {formatClock(notification.sentAt ?? notification.createdAt)}
                  </span>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </section>

      <p className="mt-8 text-center text-xs text-faint">
        Joined at {formatClock(ticket.joinedAt)} · keep this link to come back
      </p>

      <ConfirmDialog
        open={leaveOpen}
        title="Leave the queue?"
        description="You'll lose your place. You can join again, but you'd start at the back of the line."
        confirmLabel="Leave the queue"
        destructive
        busy={leaving}
        onConfirm={leave}
        onCancel={() => setLeaveOpen(false)}
      />
    </Shell>
  )
}

/** The waiting state: position enormous, everything else quiet. */
function WaitingHero({ ticket }: { ticket: TicketView }) {
  const groupsAhead = ticket.globalWaitingGroupsAhead ?? 0
  const startAhead = useHighWaterMark(groupsAhead)
  const progress = startAhead === 0 ? 1 : Math.min(1, (startAhead - groupsAhead) / startAhead)

  return (
    <div className="animate-in">
      <div className="rounded-3xl border border-line bg-surface p-8 text-center shadow-soft">
        <div className="display-number text-[6.5rem] text-brand sm:text-[7.5rem]">
          {groupsAhead}
        </div>
        <p className="mt-3 text-sm font-medium tracking-wide text-muted uppercase">Groups scheduled before you</p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="font-display text-3xl font-semibold tnum">{ticket.groupsInService}</div>
          <div className="mt-1 text-sm text-muted">
            {ticket.groupsInService === 1 ? 'group in service' : 'groups in service'}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="font-display text-3xl font-semibold tnum">
            {formatWait(ticket.estimatedWaitMinutes)}
          </div>
          <div className="mt-1 text-sm text-muted">estimated wait</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="font-display text-3xl font-semibold tnum">{ticket.lanePosition ?? '—'}</div>
          <div className="mt-1 text-sm text-muted">place in your lane</div>
        </div>
      </div>

      {startAhead > 0 ? (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-center text-xs text-faint">
            {startAhead - groupsAhead === 0
              ? 'The line has not moved yet.'
              : `You've moved up ${startAhead - groupsAhead} ${
                  startAhead - groupsAhead === 1 ? 'place' : 'places'
                } since you joined.`}
          </p>
        </div>
      ) : null}
    </div>
  )
}

/** The turn has come. One instruction, one clock, nothing else competing for attention. */
function CalledHero({ ticket }: { ticket: TicketView }) {
  const remaining = useCountdown(ticket.graceSecondsRemaining, ticket.calledAt)

  return (
    <div className="animate-in rounded-3xl bg-brand p-8 text-center text-on-brand shadow-lift">
      <p className="text-sm font-semibold tracking-[0.2em] uppercase opacity-80">Now serving</p>
      <div className="display-number mt-4 text-[3.5rem] leading-[0.92] text-balance sm:text-[4.5rem]">
        It’s your turn
      </div>
      <p className="mt-4 text-lg opacity-90">Head over to {ticket.queue.establishmentName}.</p>

      {remaining !== null ? (
        <div className="mt-7 rounded-2xl bg-on-brand/12 px-6 py-4">
          <div className="font-display text-4xl font-semibold tnum">{formatCountdown(remaining)}</div>
          <p className="mt-1 text-sm opacity-80">
            {remaining > 0 ? 'left to get there' : 'time is up — check with the staff'}
          </p>
        </div>
      ) : null}
    </div>
  )
}

/** Being served, or finished one way or another. */
function ClosingHero({ ticket }: { ticket: TicketView }) {
  const copy = {
    SERVING: {
      title: "You're being served",
      body: 'Enjoy — nothing left to do here.',
      tone: 'sage' as const,
    },
    SERVED: {
      title: 'All done',
      body: 'Thanks for waiting with us.',
      tone: 'sage' as const,
    },
    LEFT: {
      title: 'You left the queue',
      body: 'Your place has been freed up for the people behind you.',
      tone: 'neutral' as const,
    },
    NO_SHOW: {
      title: 'You missed your turn',
      body: 'The time to come over ran out. You can take a new place in line.',
      tone: 'neutral' as const,
    },
  }[ticket.status as 'SERVING' | 'SERVED' | 'LEFT' | 'NO_SHOW']

  if (!copy) return null

  return (
    <div
      className={cx(
        'animate-in rounded-3xl border p-8 text-center',
        copy.tone === 'sage' ? 'border-sage/20 bg-sage-soft' : 'border-line bg-raised',
      )}
    >
      <div
        className={cx(
          'display-number text-[3.25rem] leading-[0.95]',
          copy.tone === 'sage' ? 'text-sage' : 'text-muted',
        )}
      >
        {copy.title}
      </div>
      <p className="mt-4 text-muted">{copy.body}</p>
    </div>
  )
}

/** Remembers the worst position seen, which is what makes "you've moved up N places" meaningful. */
function useHighWaterMark(value: number): number {
  const ref = useRef(value)
  if (value > ref.current) ref.current = value
  return ref.current
}

/**
 * Ticks the grace period down locally between server pushes, so the clock never appears frozen.
 * Re-syncs whenever the server sends a fresh number.
 */
function useCountdown(seconds: number | undefined, resetKey: string | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(seconds ?? null)

  useEffect(() => {
    setRemaining(seconds ?? null)
  }, [seconds, resetKey])

  useEffect(() => {
    if (remaining === null) return
    const timer = window.setInterval(() => {
      setRemaining((value) => (value === null ? null : Math.max(0, value - 1)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [remaining === null])

  return remaining
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-5 pt-8 pb-16">
      <div className="mb-7 text-muted">
        <LogoMark className="size-7" />
        <span className="sr-only">Q</span>
      </div>
      {children}
    </main>
  )
}
