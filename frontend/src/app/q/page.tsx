'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '@/lib/api'
import { cx } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { usePathSegment } from '@/lib/usePathSegment'
import type { PublicQueueView, QueueAvailabilityView } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { LogoMark } from '@/components/Logo'
import { PageLoader } from '@/components/PageLoader'

/**
 * Functionality 1 — what the QR code opens.
 *
 * The first screen has one job: answer "is this worth the wait?" before asking for anything. So the
 * queue's real state comes first, at a size readable at arm's length, and the form sits underneath.
 */
export default function JoinQueuePage() {
  const { t, tp, locale } = useI18n()
  const queueId = usePathSegment(1)
  const [queue, setQueue] = useState<PublicQueueView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [partySize, setPartySize] = useState('2')
  const [availability, setAvailability] = useState<QueueAvailabilityView | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!queueId) {
      if (queueId === null) setLoadError(t('join.missingQueue'))
      return
    }
    const controller = new AbortController()
    api.publicApi
      .queue(queueId, controller.signal)
      .then(setQueue)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(
          cause instanceof ApiError && cause.status === 404
            ? t('join.queueGone')
            : cause instanceof ApiError
              ? cause.message
              : t('common.somethingWrong'),
        )
      })
    return () => controller.abort()
  }, [queueId, t])

  useEffect(() => {
    const size = Number(partySize)
    if (!queueId || !Number.isInteger(size) || size < 1) {
      setAvailability(null)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api.publicApi.availability(queueId, size, controller.signal).then(setAvailability, (cause: unknown) => {
        if (!controller.signal.aborted) setFormError(cause instanceof ApiError ? cause.message : 'Could not check availability.')
      })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [partySize, queueId])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!queueId || !queue) return

    setFormError(null)
    if (!partySize.trim() || Number(partySize) < 1) {
      setFormError('Enter a group size of at least 1.')
      return
    }
    if (!availability?.available) {
      setFormError('This group size cannot join right now. Adjust it or check back shortly.')
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
      // A full navigation, not a client-side push: `/t/{token}` is its own exported shell.
      window.location.href = `/t/${ticket.ticketToken}/`
    } catch (cause) {
      setFormError(cause instanceof ApiError ? cause.message : t('common.somethingWrong'))
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

  const closed = !queue.acceptingEntries || (Number(partySize) >= 1 && availability?.available === false)

  return (
    <CustomerShell>
      <div className="animate-in">
        <p className="text-sm font-medium text-muted">{queue.establishmentName}</p>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">{queue.name}</h1>
        {queue.description ? <p className="mt-2 text-muted">{queue.description}</p> : null}

        <div className="mt-7 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
            <div className="font-display text-4xl font-semibold tnum">{queue.waitingCount}</div>
            <div className="mt-1 text-sm text-muted">
              {tp('join.peopleWaiting', queue.waitingCount)}
            </div>
          </div>
          <div className="rounded-2xl border border-brand/20 bg-brand-soft p-5">
            <div className="font-display text-4xl font-semibold tnum text-brand">
              {queue.full ? t('join.full') : t('join.quoteOpen')}
            </div>
            <div className="mt-1 text-sm text-brand/80">{t('join.quoteHint')}</div>
          </div>
        </div>

        {closed ? (
          <div className="mt-7">
            <Alert kind="warn">
              {availability && !availability.eligible
                ? t('join.noLane')
                : availability?.laneFull
                  ? t('join.laneFull')
                  : queue.full || availability?.queueFull
                    ? t('join.full')
                : queue.status === 'PAUSED'
                  ? t('join.paused')
                  : t('join.closed')}
            </Alert>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5">
            <Field
              label={t('join.groupSize')}
              type="number"
              min={1}
              max={50}
              inputMode="numeric"
              value={partySize}
              onChange={(event) => setPartySize(event.target.value)}
              required
            />
            {queue.lanes?.length ? (
              <p className="text-sm text-muted">
                {t('join.laneAssigned', {
                  lanes: queue.lanes
                    .filter((lane) => lane.active)
                    .map((lane) => `${lane.name} (${lane.minPartySize}–${lane.maxPartySize ?? '∞'})`)
                    .join(', '),
                })}
              </p>
            ) : null}
            {availability ? (
              <Alert kind={availability.available ? 'info' : 'warn'}>
                {availability.available
                  ? t('join.quote', {
                      lane: availability.lane?.name ?? '',
                      lanePosition: availability.lanePosition ?? 0,
                      groupsAhead: availability.globalWaitingGroupsAhead ?? 0,
                      inService: availability.groupsInService ?? 0,
                      minutes: availability.estimatedWaitMinutes ?? 0,
                    })
                  : t('join.quoteUnavailable')}
              </Alert>
            ) : null}
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

            <Button type="submit" size="lg" block loading={submitting}>
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
