'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { cx, formatClock, formatCountdown, formatWait, notificationLabel } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { useLiveResource } from '@/lib/useLiveResource'
import { usePathSegment } from '@/lib/usePathSegment'
import type { NotificationView, TicketView } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { LiveDot } from '@/components/LiveDot'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
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
  const { t } = useI18n()
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
    return <Shell><Alert kind="error">{t('ticket.missing')}</Alert></Shell>
  }
  if (loading && !ticket) return <Shell><PageLoader label={t('ticket.finding')} /></Shell>
  if (error && !ticket) {
    return (
      <Shell>
        <Alert kind="error">
          {error.status === 404 ? t('ticket.notFound') : error.message}
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
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-muted tnum">
            {t('ticket.number', { number: ticket.ticketNumber })}
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
            {t('ticket.leave')}
          </Button>
          <p className="mt-2 text-center text-xs text-faint">{t('ticket.leaveHelp')}</p>
        </div>
      ) : ticket.status === 'LEFT' || ticket.status === 'NO_SHOW' ? (
        <div className="mt-6">
          <a href={`/q/${ticket.queue.id}/`}>
            <Button block>{t('ticket.rejoin')}</Button>
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
          <span>{t('ticket.updates')}</span>
          <span className={cx('text-faint transition-transform', showUpdates && 'rotate-180')} aria-hidden>
            ▾
          </span>
        </button>

        {showUpdates ? (
          <ul className="mt-2 space-y-1.5">
            {notifications.length === 0 ? (
              <li className="px-4 py-3 text-sm text-faint">{t('ticket.noUpdates')}</li>
            ) : (
              notifications.map((notification) => (
                <li
                  key={notification.id}
                  className="flex items-baseline justify-between gap-3 rounded-xl bg-raised/70 px-4 py-2.5 text-sm"
                >
                  <span>{notificationLabel(t, notification.type)}</span>
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
        {t('ticket.joinedAt', { time: formatClock(ticket.joinedAt) })}
      </p>

      <ConfirmDialog
        open={leaveOpen}
        title={t('ticket.confirmLeaveTitle')}
        description={t('ticket.confirmLeaveBody')}
        confirmLabel={t('ticket.leave')}
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
  const { t, tp } = useI18n()
  const peopleAhead = ticket.peopleAhead ?? 0
  const startAhead = useHighWaterMark(peopleAhead)
  const progress = startAhead === 0 ? 1 : Math.min(1, (startAhead - peopleAhead) / startAhead)

  return (
    <div className="animate-in">
      <div className="rounded-3xl border border-line bg-surface p-8 text-center shadow-soft">
        <div className="display-number text-[6.5rem] text-brand sm:text-[7.5rem]">
          {ticket.position ?? '—'}
        </div>
        <p className="mt-3 text-sm font-medium tracking-wide text-muted uppercase">
          {t('ticket.yourPosition')}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="font-display text-3xl font-semibold tnum">{peopleAhead}</div>
          <div className="mt-1 text-sm text-muted">{tp('ticket.peopleAhead', peopleAhead)}</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="font-display text-3xl font-semibold tnum">
            {formatWait(t, ticket.estimatedWaitMinutes)}
          </div>
          <div className="mt-1 text-sm text-muted">{t('ticket.estimatedWait')}</div>
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
            {startAhead - peopleAhead === 0
              ? t('ticket.notMovedYet')
              : tp('ticket.movedUp', startAhead - peopleAhead)}
          </p>
        </div>
      ) : null}
    </div>
  )
}

/** The turn has come. One instruction, one clock, nothing else competing for attention. */
function CalledHero({ ticket }: { ticket: TicketView }) {
  const { t } = useI18n()
  const remaining = useCountdown(ticket.graceSecondsRemaining, ticket.calledAt)

  return (
    <div className="animate-in rounded-3xl bg-brand p-8 text-center text-on-brand shadow-lift">
      <p className="text-sm font-semibold tracking-[0.2em] uppercase opacity-80">
        {t('ticket.nowServing')}
      </p>
      <div className="display-number mt-4 text-[3.5rem] leading-[0.92] text-balance sm:text-[4.5rem]">
        {t('ticket.itsYourTurn')}
      </div>
      <p className="mt-4 text-lg opacity-90">
        {t('ticket.headOver', { establishment: ticket.queue.establishmentName })}
      </p>

      {remaining !== null ? (
        <div className="mt-7 rounded-2xl bg-on-brand/12 px-6 py-4">
          <div className="font-display text-4xl font-semibold tnum">{formatCountdown(remaining)}</div>
          <p className="mt-1 text-sm opacity-80">
            {remaining > 0 ? t('ticket.timeLeft') : t('ticket.timeUp')}
          </p>
        </div>
      ) : null}
    </div>
  )
}

/** Being served, or finished one way or another. */
function ClosingHero({ ticket }: { ticket: TicketView }) {
  const { t } = useI18n()
  const copy = {
    SERVING: { title: t('ticket.servingTitle'), body: t('ticket.servingBody'), tone: 'sage' as const },
    SERVED: { title: t('ticket.servedTitle'), body: t('ticket.servedBody'), tone: 'sage' as const },
    LEFT: { title: t('ticket.leftTitle'), body: t('ticket.leftBody'), tone: 'neutral' as const },
    NO_SHOW: {
      title: t('ticket.noShowTitle'),
      body: t('ticket.noShowBody'),
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
      <div className="mb-7 flex items-center justify-between text-muted">
        <span>
          <LogoMark className="size-7" />
          <span className="sr-only">Q</span>
        </span>
        <LanguageSwitcher />
      </div>
      {children}
    </main>
  )
}

