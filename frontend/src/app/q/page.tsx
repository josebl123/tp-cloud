'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '@/lib/api'
import { cx } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { usePathSegment } from '@/lib/usePathSegment'
import type { PublicQueueView } from '@/lib/types'
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

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!queueId || !queue) return

    setFormError(null)
    setSubmitting(true)
    try {
      const ticket = await api.publicApi.join(queueId, {
        name: name.trim(),
        email: email.trim(),
        partySize: queue.requirePartySize ? Number(partySize) : undefined,
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

  const closed = !queue.acceptingEntries

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
              {queue.estimatedWaitMinutes === undefined || queue.estimatedWaitMinutes === 0
                ? '0'
                : queue.estimatedWaitMinutes}
              <span className="ml-1 text-lg font-medium">{t('join.minutesShort')}</span>
            </div>
            <div className="mt-1 text-sm text-brand/80">{t('join.estimatedWait')}</div>
          </div>
        </div>

        {closed ? (
          <div className="mt-7">
            <Alert kind="warn">
              {queue.full
                ? t('join.full')
                : queue.status === 'PAUSED'
                  ? t('join.paused')
                  : t('join.closed')}
            </Alert>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5">
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

            {queue.requirePartySize ? (
              <Field
                label={t('join.partySize')}
                type="number"
                min={1}
                max={50}
                inputMode="numeric"
                value={partySize}
                onChange={(event) => setPartySize(event.target.value)}
                required
              />
            ) : null}

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
