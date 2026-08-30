'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '@/lib/api'
import { cx } from '@/lib/format'
import { usePathSegment } from '@/lib/usePathSegment'
import type { PublicQueueView } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { LogoMark } from '@/components/Logo'
import { PageLoader } from '@/components/PageLoader'

type Channel = 'email' | 'phone'

/**
 * Functionality 1 — what the QR code opens.
 *
 * The first screen has one job: answer "is this worth the wait?" before asking for anything. So the
 * queue's real state comes first, at a size readable at arm's length, and the form sits underneath.
 */
export default function JoinQueuePage() {
  const queueId = usePathSegment(1)
  const [queue, setQueue] = useState<PublicQueueView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [channel, setChannel] = useState<Channel>('email')
  const [contact, setContact] = useState('')
  const [partySize, setPartySize] = useState('2')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!queueId) {
      if (queueId === null) setLoadError('This link is missing a queue.')
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
            ? "This queue doesn't exist any more. Ask the staff for a current QR code."
            : cause instanceof ApiError
              ? cause.message
              : 'Something went wrong.',
        )
      })
    return () => controller.abort()
  }, [queueId])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!queueId || !queue) return

    setFormError(null)
    setSubmitting(true)
    try {
      const ticket = await api.publicApi.join(queueId, {
        name: name.trim(),
        email: channel === 'email' ? contact.trim() : undefined,
        phone: channel === 'phone' ? contact.trim() : undefined,
        partySize: queue.requirePartySize ? Number(partySize) : undefined,
      })
      // A full navigation, not a client-side push: `/t/{token}` is its own exported shell.
      window.location.href = `/t/${ticket.ticketToken}/`
    } catch (cause) {
      setFormError(cause instanceof ApiError ? cause.message : 'Something went wrong.')
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

  if (!queue) return <CustomerShell><PageLoader label="Checking the queue" /></CustomerShell>

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
              {queue.waitingCount === 1 ? 'person waiting' : 'people waiting'}
            </div>
          </div>
          <div className="rounded-2xl border border-brand/20 bg-brand-soft p-5">
            <div className="font-display text-4xl font-semibold tnum text-brand">
              {queue.estimatedWaitMinutes === undefined || queue.estimatedWaitMinutes === 0
                ? '0'
                : queue.estimatedWaitMinutes}
              <span className="ml-1 text-lg font-medium">min</span>
            </div>
            <div className="mt-1 text-sm text-brand/80">estimated wait</div>
          </div>
        </div>

        {closed ? (
          <div className="mt-7">
            <Alert kind="warn">
              {queue.full
                ? 'This queue is full right now. Please check back in a little while.'
                : queue.status === 'PAUSED'
                  ? 'This queue is paused and not taking new people at the moment.'
                  : 'This queue is closed right now.'}
            </Alert>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5">
            <Field
              label="Your name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ana Perez"
              autoComplete="name"
              maxLength={120}
              required
            />

            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">How should we reach you?</span>
              </div>
              <div
                role="tablist"
                aria-label="Contact method"
                className="mb-3 inline-flex rounded-xl border border-line-strong bg-raised p-1"
              >
                {(['email', 'phone'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={channel === option}
                    onClick={() => {
                      setChannel(option)
                      setContact('')
                    }}
                    className={cx(
                      'rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
                      channel === option ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink',
                    )}
                  >
                    {option === 'email' ? 'Email' : 'Phone'}
                  </button>
                ))}
              </div>
              <Field
                label={channel === 'email' ? 'Email address' : 'Phone number'}
                type={channel === 'email' ? 'email' : 'tel'}
                inputMode={channel === 'email' ? 'email' : 'tel'}
                autoComplete={channel === 'email' ? 'email' : 'tel'}
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder={channel === 'email' ? 'ana@example.com' : '+54 9 11 0000 0000'}
                hint="We send your ticket link here, so you can close this page and come back to it."
                required
              />
            </div>

            {queue.requirePartySize ? (
              <Field
                label="How many people?"
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
              Take my place in line
            </Button>
            <p className="text-center text-xs text-faint">
              You can leave the queue at any time, from the same link.
            </p>
          </form>
        )}
      </div>
    </CustomerShell>
  )
}

function CustomerShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-5 pt-8 pb-16">
      <div className="mb-8 text-muted">
        <LogoMark className="size-7" />
        <span className="sr-only">Q</span>
      </div>
      {children}
    </main>
  )
}
