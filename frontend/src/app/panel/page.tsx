'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { errorMessage, formatMinutes, formatPercent, queueStatusLabel, queueStatusTone } from '@/lib/format'
import type { MetricsView, QueueSnapshot, QueueView } from '@/lib/types'
import { ActionMenu } from '@/components/ActionMenu'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { EmptyState } from '@/components/EmptyState'
import { PageLoader } from '@/components/PageLoader'
import { Stat } from '@/components/Stat'

/** The operator's home: how today is going, and every queue at a glance. */
export default function PanelHomePage() {
  const router = useRouter()
  const { activeEstablishment, isOwner, establishments, initialising, restoreError, retryRestore } =
    useAuth()
  const { t } = useI18n()
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
      setError(errorMessage(t, cause))
      // Deliberately NOT `setQueues([])`. An empty array is indistinguishable from "this business
      // has no queues", so a transient failure used to render the "You have no queues yet" empty
      // state complete with a Create button - inviting the owner to make a duplicate of a queue
      // that already exists and is merely unreachable.
      setQueues((current) => current ?? null)
    }
  }, [establishmentId, t])

  useEffect(() => {
    void loadQueues()
  }, [loadQueues])

  // Live counts per queue plus today's roll-up, refreshed on a slow interval. The board page is
  // where second-by-second accuracy matters; here a periodic sweep is plenty and far cheaper.
  useEffect(() => {
    if (!establishmentId || !queues) return

    // Without this, switching establishment left the previous one's sweep in flight; whichever
    // response landed last won, and the tiles could end up showing another business's numbers.
    let cancelled = false

    const refresh = async () => {
      const [snapshots, summary] = await Promise.all([
        Promise.all(
          queues.map((queue) => api.queues.board(queue.id).then((board) => [queue.id, board] as const).catch(() => null)),
        ),
        api.establishments.metrics(establishmentId, 'TODAY').catch(() => null),
      ])
      if (cancelled) return
      setBoards(Object.fromEntries(snapshots.filter((entry) => entry !== null)))
      if (summary) setMetrics(summary)
    }

    void refresh()
    const timer = window.setInterval(refresh, 10_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [establishmentId, queues])

  // A signed-in operator whose establishments failed to load, or who has none, used to sit on a
  // spinner with no explanation and no way out.
  if (restoreError || (!initialising && establishments.length === 0)) {
    return (
      <EmptyState
        title={restoreError ? t('panel.noAccessTitle') : t('panel.noEstablishmentTitle')}
        description={restoreError ? t('panel.noAccessBody') : t('panel.noEstablishmentBody')}
        action={
          restoreError ? <Button onClick={retryRestore}>{t('panel.retry')}</Button> : undefined
        }
      />
    )
  }
  if (!activeEstablishment) return <PageLoader label={t('panel.loadingEstablishment')} />
  if (queues === null) {
    return error ? (
      <div className="space-y-4">
        <Alert kind="error">{error}</Alert>
        <Button onClick={() => void loadQueues()}>{t('panel.retry')}</Button>
      </div>
    ) : (
      <PageLoader label={t('panel.loadingQueues')} />
    )
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">{t('panel.today')}</h1>
            <p className="mt-1 text-sm text-muted">{activeEstablishment.name}</p>
          </div>
          <ButtonLink href="/panel/analytics" variant="secondary" size="sm">
            {t('panel.openAnalytics')}
          </ButtonLink>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t('panel.waitingNow')} value={metrics?.waitingNow ?? '—'} emphasis />
          <Stat label={t('panel.servedToday')} value={metrics?.servedCount ?? '—'} />
          <Stat
            label={t('panel.averageWait')}
            value={metrics ? formatMinutes(metrics.averageWaitMinutes) : '—'}
            hint={t('panel.joinToCalled')}
          />
          <Stat
            label={t('panel.noShows')}
            value={metrics ? formatPercent(metrics.noShowRate) : '—'}
            hint={
              metrics
                ? t('panel.ofFinished', { count: metrics.noShowCount, total: metrics.finishedCount })
                : undefined
            }
          />
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-semibold tracking-tight">{t('panel.queues')}</h2>
          {isOwner ? (
            <Button size="sm" onClick={() => setCreating((value) => !value)}>
              {creating ? t('common.cancel') : t('panel.newQueue')}
            </Button>
          ) : null}
        </div>

        {error ? <Alert kind="error">{error}</Alert> : null}

        {creating && establishmentId ? (
          <div className="mb-4">
            <CreateQueueForm
              establishmentId={establishmentId}
              onCreated={(created) => {
                setCreating(false)
                void loadQueues()
                router.push(`/panel/queue/settings?id=${created.id}`)
              }}
            />
          </div>
        ) : null}

        {queues.length === 0 && !creating ? (
          <EmptyState
            title={t('panel.noQueuesTitle')}
            description={t('panel.noQueuesBody')}
            action={
              isOwner ? (
                <Button onClick={() => setCreating(true)}>{t('panel.createFirstQueue')}</Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
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
  const { t } = useI18n()

  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold tracking-tight">{queue.name}</h3>
          {queue.description ? (
            <p className="mt-0.5 truncate text-sm text-muted">{queue.description}</p>
          ) : null}
        </div>
        <Badge tone={queueStatusTone(queue.status)} dot>
          {queueStatusLabel(t, queue.status)}
        </Badge>
      </div>

      <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          <div className="font-display text-3xl font-semibold tnum">{board?.waitingCount ?? '—'}</div>
          <div className="text-xs text-muted">{t('panel.waiting')}</div>
        </div>
        <div>
          <div className="font-display text-3xl font-semibold tnum">{board?.inServiceCount ?? '—'}</div>
          <div className="text-xs text-muted">{t('panel.beingServed')}</div>
        </div>
      </div>

      {/*
        Three side-by-side buttons wrap onto two lines once the grid narrows to a third of the
        width, which reads as three equal choices when only one of them is the common one. The
        secondary two move behind a menu; they stay anchors inside it.
      */}
      <div className="mt-6 flex items-center gap-2">
        <ButtonLink href={`/panel/queue?id=${queue.id}`} size="sm" className="flex-1">
          {t('panel.openBoard')}
        </ButtonLink>
        <ActionMenu
          label={t('common.moreActions')}
          items={[
            { label: t('common.qr'), href: `/panel/queue/qr?id=${queue.id}` },
            { label: t('common.settings'), href: `/panel/queue/settings?id=${queue.id}` },
          ]}
        />
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
  onCreated: (queue: QueueView) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [serviceStations, setServiceStations] = useState('1')
  const [defaultServiceMinutes, setDefaultServiceMinutes] = useState('10')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { t } = useI18n()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const created = await api.establishments.createQueue(establishmentId, {
        name: name.trim(),
        description: description.trim() || undefined,
        serviceStations: Number(serviceStations),
        defaultServiceMinutes: Number(defaultServiceMinutes),
      })
      onCreated(created)
    } catch (cause) {
      setError(errorMessage(t, cause))
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader title={t('panel.newQueue')} description={t('panel.newQueueHint')} />
      <form onSubmit={submit} className="space-y-4">
        <Field
          label={t('panel.queueName')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('panel.queueNamePlaceholder')}
          maxLength={120}
          required
        />
        <Field
          label={t('panel.description')}
          optional
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t('panel.descriptionPlaceholder')}
          maxLength={500}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('panel.servicePoints')}
            type="number"
            min={1}
            value={serviceStations}
            onChange={(event) => setServiceStations(event.target.value)}
            hint={t('panel.servicePointsHint')}
            required
          />
          <Field
            label={t('panel.typicalService')}
            type="number"
            min={1}
            value={defaultServiceMinutes}
            onChange={(event) => setDefaultServiceMinutes(event.target.value)}
            hint={t('panel.typicalServiceHint')}
            required
          />
        </div>
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Button type="submit" loading={submitting}>
          {t('panel.createQueue')}
        </Button>
      </form>
    </Card>
  )
}
