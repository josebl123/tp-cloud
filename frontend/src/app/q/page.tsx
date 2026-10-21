'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, api } from '@/lib/api'
import { errorMessage, formatWaitNeutral, queueStatusLabel, queueStatusTone } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useQueryParam } from '@/lib/useQueryParam'
import type { PublicQueueView, QueueAvailabilityView } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { LogoMark } from '@/components/Logo'
import { PageLoader } from '@/components/PageLoader'
import { WaitFigure } from '@/components/WaitFigure'

/**
 * Functionality 1 — what the QR code opens.
 *
 * The first screen has one job: answer "is this worth the wait?" before asking for anything. So the
 * queue's real state comes first, at a size readable at arm's length, and the form sits underneath.
 */
export default function JoinQueuePage() {
  const { t, tp, locale } = useI18n()
  const queueId = useQueryParam('id')
  const [queue, setQueue] = useState<PublicQueueView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [partySize, setPartySize] = useState('2')
  const [availability, setAvailability] = useState<QueueAvailabilityView | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  // Whether the first load ever succeeded, so a later refresh failing does not blank a good page.
  const loadedOnce = useRef(false)

  /*
   * This was the only screen in the app that never updated. It is also the one that has to answer
   * "is this worth the wait?", and the one most likely to be left open while somebody decides - so
   * both numbers on it could be minutes stale by the time they act on them. Worse, a queue that was
   * paused or full when the page loaded stayed that way on screen forever: the customer had to know
   * to reload before they could ever join. Polling while the tab is actually being looked at fixes
   * both, and costs one small public read every fifteen seconds.
   */
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSubmitting(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick((value) => value + 1)
    }, 15_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((value) => value + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    if (!queueId) {
      if (queueId === null) setLoadError(t('join.missingQueue'))
      return
    }
    const controller = new AbortController()
    api.publicApi
      .queue(queueId, controller.signal)
      .then((loaded) => {
        loadedOnce.current = true
        setQueue(loaded)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        // A failed refresh must not blank a page that is already showing good data; keep the last
        // good state and try again on the next tick.
        if (loadedOnce.current) return
        setLoadError(
          cause instanceof ApiError && cause.status === 404
            ? t('join.queueGone')
            : errorMessage(t, cause),
        )
      })
    return () => controller.abort()
  }, [queueId, t, tick])

  useEffect(() => {
    const size = Number(partySize)
    if (!queueId || !Number.isInteger(size) || size < 1) {
      setAvailability(null)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api.publicApi.availability(queueId, size, controller.signal).then(
        (loaded) => {
          setAvailability(loaded)
          setFormError(null)
        },
        (cause: unknown) => {
          if (!controller.signal.aborted) setFormError(errorMessage(t, cause))
        },
      )
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [partySize, queueId, t, tick])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!queueId || !queue) return

    setFormError(null)
    if (!partySize.trim() || Number(partySize) < 1) {
      setFormError(t('join.groupSizeRequired'))
      return
    }
    if (!availability?.available) {
      setFormError(t('join.sizeUnavailable'))
      return
    }
    setSubmitting(true)
    try {
      const ticket = await api.publicApi.join(queueId, {
        name: name.trim(),
        email: email.trim(),
        partySize: Number(partySize),
        // Remembered server-side, so the ticket email arrives in the language this page is in.
        locale,
      })
      // A full navigation, not a client-side push: `/t/` is its own exported shell. Being built by
      // hand, the URL has to carry the base path itself - Next only adds it to its own links.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/t/?token=${ticket.ticketToken}`
    } catch (cause) {
      setFormError(errorMessage(t, cause))
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <CustomerShell>
        <Alert kind="error">{loadError}</Alert>
      </CustomerShell>
    )
  }

  if (!queue) return <CustomerShell><PageLoader label={t('join.checking')} /></CustomerShell>

  const queueShut = !queue.acceptingEntries
  const sizeBlocked = !queueShut && Number(partySize) >= 1 && availability?.available === false

  return (
    <CustomerShell>
      <div className="animate-in">
        <p className="text-sm font-medium text-muted">{queue.establishmentName}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display text-4xl font-semibold tracking-tight">{queue.name}</h1>
          <Badge tone={queueStatusTone(queue.status)} dot>
            {queueStatusLabel(t, queue.status)}
          </Badge>
        </div>
        {queue.description ? <p className="mt-2 text-muted">{queue.description}</p> : null}

        {/*
          The two questions someone asks before they commit, as two numbers. The display face is
          reserved for numerals here: a status word set at 4rem reads as a quantity and is not one,
          which is why the queue's state moved into the badge above.
        */}
        <div className="mt-7 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
            <div className="font-display text-4xl font-semibold tnum">{queue.waitingCount}</div>
            <div className="mt-1 text-sm text-muted">
              {tp('join.peopleWaiting', queue.waitingCount)}
            </div>
          </div>
          <div className="rounded-2xl border border-brand/20 bg-brand-soft p-5">
            {availability?.available ? (
              <WaitFigure minutes={availability.estimatedWaitMinutes} neutral className="text-brand" />
            ) : (
              <div className="font-display text-3xl font-semibold text-brand">{t('join.noEstimate')}</div>
            )}
            <div className="mt-1 text-sm text-brand/80">
              {availability?.available
                ? `${t('join.estimateLabel')} ${t('join.quoteHint', { size: partySize || '?' })}`
                : t('join.estimateLabel')}
            </div>
          </div>
        </div>

        {queueShut ? (
          <div className="mt-7 space-y-2">
            <Alert kind="warn">
              {queue.full
                ? t('join.full')
                : queue.status === 'PAUSED'
                  ? t('join.paused')
                  : t('join.closed')}
            </Alert>
            <p className="text-center text-xs text-faint">{t('join.watching')}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5">
            <div className="space-y-3">
              <Field
                label={t('join.groupSize')}
                type="number"
                min={1}
                max={50}
                inputMode="numeric"
                value={partySize}
                onChange={(event) => setPartySize(event.target.value)}
                hint={queue.lanes && queue.lanes.filter((lane) => lane.active).length > 1
                  ? t('join.sizeMatters')
                  : undefined}
                required
              />
              {availability ? (
                <Alert kind={availability.available ? 'info' : 'warn'}>
                  {availability.available
                    ? tp('join.aheadOfYou', availability.globalWaitingGroupsAhead ?? 0)
                    : !availability.eligible
                      ? t('join.noLane')
                      : availability.laneFull
                        ? t('join.laneFull')
                        : availability.queueFull
                          ? t('join.full')
                          : t('join.quoteUnavailable')}
                </Alert>
              ) : null}
              {/*
                The estimate re-reads as the number is typed. Sighted readers already have it in
                the card above, so the live region carries the whole answer instead of repeating
                the figure on screen: someone who cannot see the card still hears both halves.
              */}
              <p aria-live="polite" aria-atomic="true" className="sr-only">
                {availability?.available
                  ? `${t('join.quoteWait', {
                      wait: formatWaitNeutral(t, availability.estimatedWaitMinutes),
                    })} ${tp('join.aheadOfYou', availability.globalWaitingGroupsAhead ?? 0)}`
                  : ''}
              </p>
            </div>

            <Field
              label={t('join.yourName')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('join.namePlaceholder')}
              autoComplete="name"
              maxLength={120}
              required
            />

            <Field
              label={t('join.emailLabel')}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('join.emailPlaceholder')}
              maxLength={255}
              hint={t('join.contactHint')}
              required
            />

            {formError ? <Alert kind="error">{formError}</Alert> : null}

            <Button type="submit" size="lg" block loading={submitting} disabled={sizeBlocked}>
              {t('join.submit')}
            </Button>
            <p className="text-center text-xs text-faint">{t('join.leaveAnytime')}</p>
          </form>
        )}
      </div>
    </CustomerShell>
  )
}

function CustomerShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-5 pt-8 pb-16">
      <div className="mb-8 flex items-center justify-between text-muted">
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
