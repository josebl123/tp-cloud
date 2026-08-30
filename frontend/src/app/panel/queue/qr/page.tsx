'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ApiError, api } from '@/lib/api'
import { useQueryParam } from '@/lib/usePathSegment'
import type { QueueView } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { PageLoader } from '@/components/PageLoader'

/**
 * The sheet a business prints and tapes to the counter.
 *
 * Designed for paper first: at print time the app chrome disappears and what is left is a QR big
 * enough to scan from a step away, plus the one line of instruction someone needs.
 */
export default function QueueQrPage() {
  const queueId = useQueryParam('id')
  const [queue, setQueue] = useState<QueueView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!queueId) return
    api.queues.get(queueId).then(setQueue, (cause: unknown) =>
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong.'),
    )
  }, [queueId])

  const copy = async () => {
    if (!queue) return
    try {
      await navigator.clipboard.writeText(queue.joinUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  if (queueId === null) return <Alert kind="error">No queue selected.</Alert>
  if (error) return <Alert kind="error">{error}</Alert>
  if (!queue) return <PageLoader label="Preparing the QR code" />

  return (
    <div className="mx-auto max-w-xl">
      <div className="no-print mb-6">
        <Link href={`/panel/queue?id=${queue.id}`} className="text-sm text-muted hover:text-ink">
          ← Back to the board
        </Link>
      </div>

      <div className="rounded-3xl border border-line bg-surface p-10 text-center shadow-soft print:border-0 print:shadow-none">
        <p className="text-sm font-medium text-muted">{queue.establishmentName}</p>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">{queue.name}</h1>
        <p className="mt-4 text-lg text-muted">Scan to join the queue</p>

        <div className="mt-8 flex justify-center">
          {/* Public endpoint, so a plain <img> works and the sheet prints from any browser. */}
          <img
            src={api.publicApi.qrUrl(queue.id, 640)}
            alt={`QR code to join the ${queue.name} queue`}
            width={320}
            height={320}
            className="rounded-2xl border border-line bg-white p-3"
          />
        </div>

        <p className="mt-8 text-sm text-muted">
          No app to install. You&apos;ll see your place in line and we&apos;ll tell you when it&apos;s your turn.
        </p>
        <p className="mt-4 font-mono text-xs break-all text-faint">{queue.joinUrl}</p>
      </div>

      <div className="no-print mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={() => window.print()}>Print this sheet</Button>
        <Button variant="secondary" onClick={copy}>
          {copied ? 'Link copied' : 'Copy join link'}
        </Button>
        <a href={queue.joinUrl} target="_blank" rel="noreferrer">
          <Button variant="ghost">Preview as a customer</Button>
        </a>
      </div>
    </div>
  )
}
