'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatMinutes, formatPercent, formatWaitNeutral, queueStatusLabel, queueStatusTone } from '@/lib/format'
import type { MetricsView, QueueSnapshot, QueueView } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { EmptyState } from '@/components/EmptyState'
import { PageLoader } from '@/components/PageLoader'
import { Stat } from '@/components/Stat'

/** The operator's home: how today is going, and every queue at a glance. */
export default function PanelHomePage() {
  const { activeEstablishment, isOwner } = useAuth()
  const establishmentId = activeEstablishment?.id ?? null

  const [queues, setQueues] = useState<QueueView[] | null>(null)
  const [boards, setBoards] = useState<Record<string, QueueSnapshot>>({})
  const [metrics, setMetrics] = useState<MetricsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const loadQueues = useCallback(async () => {
    if (!establishmentId) return
    try {
      const list = await api.establishments.queues(establishmentId)
      setQueues(list)
      setError(null)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong.')
      setQueues([])
    }
  }, [establishmentId])

  useEffect(() => {
    void loadQueues()
  }, [loadQueues])

  // Live counts per queue plus today's roll-up, refreshed on a slow interval. The board page is
  // where second-by-second accuracy matters; here a periodic sweep is plenty and far cheaper.
  useEffect(() => {
    if (!establishmentId || !queues) return

    const refresh = async () => {
      const [snapshots, summary] = await Promise.all([
        Promise.all(
          queues.map((queue) => api.queues.board(queue.id).then((board) => [queue.id, board] as const).catch(() => null)),
        ),
        api.establishments.metrics(establishmentId, 'TODAY').catch(() => null),
      ])
      setBoards(Object.fromEntries(snapshots.filter((entry) => entry !== null)))
      if (summary) setMetrics(summary)
    }

    void refresh()
    const timer = window.setInterval(refresh, 10_000)
    return () => window.clearInterval(timer)
  }, [establishmentId, queues])

  if (!activeEstablishment) return <PageLoader label="Loading your establishment" />
  if (queues === null) return <PageLoader label="Loading queues" />

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Today</h1>
            <p className="mt-1 text-sm text-muted">{activeEstablishment.name}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Waiting now" value={metrics?.waitingNow ?? '—'} emphasis />
          <Stat label="Served today" value={metrics?.servedCount ?? '—'} />
          <Stat
            label="Average wait"
            value={metrics ? formatMinutes(metrics.averageWaitMinutes) : '—'}
            hint="join to called"
          />
          <Stat
            label="No-shows"
            value={metrics ? formatPercent(metrics.noShowRate) : '—'}
            hint={metrics ? `${metrics.noShowCount} of ${metrics.finishedCount}` : undefined}
          />
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-semibold tracking-tight">Queues</h2>
          {isOwner ? (
            <Button size="sm" onClick={() => setCreating((value) => !value)}>
              {creating ? 'Cancel' : 'New queue'}
            </Button>
          ) : null}
        </div>

        {error ? <Alert kind="error">{error}</Alert> : null}

        {creating && establishmentId ? (
          <div className="mb-4">
            <CreateQueueForm
              establishmentId={establishmentId}
              onCreated={() => {
                setCreating(false)
                void loadQueues()
              }}
            />
          </div>
        ) : null}

        {queues.length === 0 && !creating ? (
          <EmptyState
            title="No queues yet"
            description="A queue is one line with one QR code — a dining room, a counter, a service desk."
            action={
              isOwner ? <Button onClick={() => setCreating(true)}>Create your first queue</Button> : undefined
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {queues.map((queue) => (
              <QueueCard key={queue.id} queue={queue} board={boards[queue.id]} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function QueueCard({ queue, board }: { queue: QueueView; board: QueueSnapshot | undefined }) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold tracking-tight">{queue.name}</h3>
          {queue.description ? (
            <p className="mt-0.5 truncate text-sm text-muted">{queue.description}</p>
          ) : null}
        </div>
        <Badge tone={queueStatusTone(queue.status)} dot>
          {queueStatusLabel(queue.status)}
        </Badge>
      </div>

      <div className="mt-5 flex items-baseline gap-6">
        <div>
          <div className="font-display text-3xl font-semibold tnum">{board?.waitingCount ?? '—'}</div>
          <div className="text-xs text-muted">waiting</div>
        </div>
        <div>
          <div className="font-display text-3xl font-semibold tnum">{board?.inServiceCount ?? '—'}</div>
          <div className="text-xs text-muted">being served</div>
        </div>
        <div>
          <div className="font-display text-2xl font-semibold tnum text-brand">
            {board ? formatWaitNeutral(board.estimatedWaitMinutesForNewEntry) : '—'}
          </div>
          <div className="text-xs text-muted">for a new arrival</div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href={`/panel/queue?id=${queue.id}`} className="flex-1">
          <Button block size="sm">
            Open board
          </Button>
        </Link>
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
    </Card>
  )
}

/** Only the fields you need to open a line today; everything else lives in Settings. */
function CreateQueueForm({
  establishmentId,
  onCreated,
}: {
  establishmentId: string
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [serviceStations, setServiceStations] = useState('1')
  const [defaultServiceMinutes, setDefaultServiceMinutes] = useState('10')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.establishments.createQueue(establishmentId, {
        name: name.trim(),
        description: description.trim() || undefined,
        serviceStations: Number(serviceStations),
        defaultServiceMinutes: Number(defaultServiceMinutes),
      })
      onCreated()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader title="New queue" description="You can fine-tune waits and no-show rules afterwards." />
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Tables"
          maxLength={120}
          required
        />
        <Field
          label="Description"
          optional
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Main dining room queue"
          maxLength={500}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Service points"
            type="number"
            min={1}
            value={serviceStations}
            onChange={(event) => setServiceStations(event.target.value)}
            hint="How many people you can serve at once."
            required
          />
          <Field
            label="Typical service time"
            type="number"
            min={1}
            value={defaultServiceMinutes}
            onChange={(event) => setDefaultServiceMinutes(event.target.value)}
            hint="Minutes. Replaced by real measurements later."
            required
          />
        </div>
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Button type="submit" loading={submitting}>
          Create queue
        </Button>
      </form>
    </Card>
  )
}
