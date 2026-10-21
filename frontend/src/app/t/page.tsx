'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { cx, errorMessage, formatClock, formatCountdown, notificationLabel } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { useLiveResource } from '@/lib/useLiveResource'
import { useQueryParam } from '@/lib/useQueryParam'
import type { NotificationView, TicketView } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Button, ButtonLink } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { LiveDot } from '@/components/LiveDot'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { LogoMark } from '@/components/Logo'
import { PageLoader } from '@/components/PageLoader'
import { WaitFigure } from '@/components/WaitFigure'

/**
 * Functionalities 2, 3 and 5 — the screen a customer actually keeps open.
 *
 * Whatever else is on it, one number has to be readable from a pocket-glance away, so the position
 * is set enormous and everything else is deliberately quiet. When the turn arrives the screen stops
 * being an information display and becomes a single instruction.
 */
export default function TicketPage() {
  const { t } = useI18n()
  const token = useQueryParam('token')
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [notifications, setNotifications] = useState<NotificationView[]>([])
  const [showUpdates, setShowUpdates] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const [updatesFailed, setUpdatesFailed] = useState(false)
  const disclosureId = useId()

  const load = useCallback(
    (signal: AbortSignal) => api.publicApi.ticket(token as string, signal),
    [token],
  )

  const socket = useCallback(() => (token ? api.realtime.ticket(token) : Promise.resolve(null)), [token])

  const { data: ticket, error, live, loading, refresh } = useLiveResource<TicketView>({
    socket,
    eventName: 'ticket.updated',
    load,
    enabled: Boolean(token),
  })

  useEffect(() => {
    if (!token || !showUpdates) return
    api.publicApi.notifications(token).then(
      (loaded) => {
        setNotifications(loaded)
        setUpdatesFailed(false)
      },
      () => setUpdatesFailed(true),
    )
  }, [token, showUpdates, ticket?.status])

  useTurnSignal(ticket ?? null)

  const leave = async () => {
    if (!token) return
    setLeaving(true)
    setLeaveError(null)
    try {
      await api.publicApi.leave(token)
      setLeaveOpen(false)
      refresh()
    } catch (cause) {
      setLeaveOpen(false)
      setLeaveError(errorMessage(t, cause))
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
          {error.status === 404 ? t('ticket.notFound') : errorMessage(t, error)}
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
          {ticket.laneName ? (
            <p className="mt-1 text-sm text-muted">{t('ticket.yourLine', { name: ticket.laneName })}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-muted tnum">
            {t('ticket.number', { number: ticket.ticketNumber })}
          </span>
          <LiveDot live={live} />
        </div>
      </header>

      {/*
        The status change is pushed while the phone is very likely in a pocket. Announcing it to
        assistive technology costs nothing and is the only channel that reaches a screen reader
        user at all; the tab title and the buzz in `useTurnSignal` cover everyone else.
      */}
      <p aria-live="assertive" className="sr-only">
        {ticket.status === 'CALLED'
          ? t('ticket.calledAnnounce', { establishment: ticket.queue.establishmentName })
          : ''}
      </p>

      <div className="mt-6">
        {ticket.status === 'CALLED' ? (
          <CalledHero ticket={ticket} />
        ) : ticket.status === 'WAITING' ? (
          <WaitingHero ticket={ticket} />
        ) : (
          <ClosingHero ticket={ticket} />
        )}
      </div>

      {leaveError ? (
        <div className="mt-6">
          <Alert kind="error">{leaveError}</Alert>
        </div>
      ) : null}

      {ticket.status === 'WAITING' || ticket.status === 'CALLED' ? (
        <div className="mt-6">
          <Button variant="secondary" block onClick={() => setLeaveOpen(true)}>
            {t('ticket.leave')}
          </Button>
          <p className="mt-2 text-center text-xs text-faint">{t('ticket.leaveHelp')}</p>
        </div>
      ) : ticket.status === 'LEFT' || ticket.status === 'NO_SHOW' ? (
        <div className="mt-6">
          <ButtonLink href={`/q/?id=${ticket.queue.id}`} block>
            {t('ticket.rejoin')}
          </ButtonLink>
        </div>
      ) : null}

      <section className="mt-8">
        <button
          type="button"
          onClick={() => setShowUpdates((value) => !value)}
          className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-raised"
          aria-expanded={showUpdates}
          aria-controls={disclosureId}
        >
          <span>{t('ticket.updates')}</span>
          <span className={cx('text-faint transition-transform', showUpdates && 'rotate-180')} aria-hidden>
            ▾
          </span>
        </button>

        {showUpdates ? (
          <ul id={disclosureId} className="mt-2 space-y-1.5">
            {updatesFailed ? (
              <li className="px-4 py-3 text-sm text-danger">{t('ticket.updatesFailed')}</li>
            ) : notifications.length === 0 ? (
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
  const groupsAhead = ticket.globalWaitingGroupsAhead ?? 0
  const startAhead = useHighWaterMark(groupsAhead)
  const progress = startAhead === 0 ? 1 : Math.min(1, (startAhead - groupsAhead) / startAhead)

  return (
    <div className="animate-in">
      <div className="rounded-3xl border border-line bg-surface p-8 text-center shadow-soft">
        <div className="display-number text-[6.5rem] text-brand sm:text-[7.5rem]">
          {groupsAhead}
        </div>
        <p className="mt-3 text-sm font-medium tracking-wide text-muted uppercase">
          {t('ticket.groupsScheduledBefore')}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="font-display text-3xl font-semibold tnum">{ticket.groupsInService}</div>
          <div className="mt-1 text-sm text-muted">
            {tp('ticket.groupsInService', ticket.groupsInService)}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <WaitFigure minutes={ticket.estimatedWaitMinutes} />
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
            {startAhead - groupsAhead === 0
              ? t('ticket.notMovedYet')
              : tp('ticket.movedUp', startAhead - groupsAhead)}
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

/**
 * Carries "it's your turn" past the edge of the viewport.
 *
 * <p>The invitation on this page is to close it and get on with your evening, which means the one
 * moment that matters usually arrives while the tab is in the background. Three signals, none of
 * them requiring a permission prompt: the tab title, so a glance at the browser is enough; a short
 * vibration on the phones that support it; and a live region for a screen reader. A notification
 * would need `Notification.requestPermission`, and asking for that before the customer has any
 * reason to trust the page is how permission prompts get denied forever.
 */
function useTurnSignal(ticket: TicketView | null) {
  const { t } = useI18n()
  const previousStatus = useRef<string | null>(null)

  useEffect(() => {
    if (!ticket) return

    document.title =
      ticket.status === 'CALLED'
        ? t('ticket.tabCalled')
        : ticket.status === 'WAITING'
          ? t('ticket.tabWaiting', { count: ticket.globalWaitingGroupsAhead ?? 0 })
          : 'Q'

    const arrived = previousStatus.current !== null && previousStatus.current !== 'CALLED'
    previousStatus.current = ticket.status
    if (ticket.status !== 'CALLED' || !arrived) return

    try {
      navigator.vibrate?.([180, 90, 180])
    } catch {
      // Vibration is a nicety, and some browsers throw rather than no-op when it is unavailable.
    }
  }, [ticket, t])

  useEffect(() => () => {
    document.title = 'Q'
  }, [])
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

  // Restart the interval only when the countdown appears or disappears, not on every tick.
  const idle = remaining === null

  useEffect(() => {
    if (idle) return
    const timer = window.setInterval(() => {
      setRemaining((value) => (value === null ? null : Math.max(0, value - 1)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [idle])

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
