'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ApiError, api } from '@/lib/api'
import { errorMessage, queueStatusLabel, queueStatusTone } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useI18n, type Translate } from '@/lib/i18n'
import { useQueryParam } from '@/lib/usePathSegment'
import type { CallStrategy, LaneCapacityMode, NoShowPolicy, QueueLaneView, QueueView } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field, SelectField } from '@/components/ui/Field'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageLoader } from '@/components/PageLoader'

const policyHelp = (t: Translate): Record<NoShowPolicy, string> => ({
  KEEP_POSITION: t('settings.policyKeepHelp'),
  MOVE_BACK: t('settings.policyMoveBackHelp'),
  MOVE_TO_END: t('settings.policyMoveEndHelp'),
  REMOVE: t('settings.policyRemoveHelp'),
})

/** Everything about how a queue behaves. Owner-only; the API enforces that too. */
export default function QueueSettingsPage() {
  const router = useRouter()
  const queueId = useQueryParam('id')
  const { isOwner } = useAuth()
  const { t } = useI18n()

  const [queue, setQueue] = useState<QueueView | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [policy, setPolicy] = useState<NoShowPolicy>('MOVE_TO_END')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [laneToDelete, setLaneToDelete] = useState<QueueLaneView | null>(null)
  const [laneDraft, setLaneDraft] = useState({ name: '', minPartySize: '1', maxPartySize: '', priority: '0', capacityMode: 'GROUPS' as LaneCapacityMode, maxSize: '', timeFactor: '1' })
  const [laneBusy, setLaneBusy] = useState(false)
  const [laneFeedback, setLaneFeedback] = useState<{ kind: 'info' | 'error'; message: string } | null>(null)
  const [callStrategy, setCallStrategy] = useState<CallStrategy>('GLOBAL_AGE')

  useEffect(() => {
    if (!queueId) return
    api.queues.get(queueId).then(
      (loaded) => {
        setQueue(loaded)
        setPolicy(loaded.noShowPolicy)
        setCallStrategy(loaded.callStrategy)
        setForm({
          name: loaded.name,
          description: loaded.description ?? '',
          serviceStations: String(loaded.serviceStations),
          defaultServiceMinutes: String(loaded.defaultServiceMinutes),
          maxSize: loaded.maxSize === undefined ? '' : String(loaded.maxSize),
          gracePeriodSeconds: String(loaded.gracePeriodSeconds),
          moveBackPositions: String(loaded.moveBackPositions),
          notifyAtPosition: loaded.notifyAtPosition === undefined ? '' : String(loaded.notifyAtPosition),
          notifyAtMinutes: loaded.notifyAtMinutes === undefined ? '' : String(loaded.notifyAtMinutes),
        })
      },
      (cause: unknown) => setError(errorMessage(t, cause)),
    )
  }, [queueId, t])

  const update = (key: string) => (event: { target: { value: string } }) => {
    setForm((current) => ({ ...current, [key]: event.target.value }))
    setSaved(false)
  }

  const save = async () => {
    if (!queueId) return
    setError(null)
    setSaving(true)
    try {
      // An empty box means "no limit" / "don't notify", which the API needs told explicitly.
      const updated = await api.queues.update(queueId, {
        name: form.name?.trim(),
        description: form.description?.trim() ?? '',
        serviceStations: Number(form.serviceStations),
        defaultServiceMinutes: Number(form.defaultServiceMinutes),
        maxSize: form.maxSize ? Number(form.maxSize) : undefined,
        clearMaxSize: !form.maxSize,
        gracePeriodSeconds: Number(form.gracePeriodSeconds),
        noShowPolicy: policy,
        moveBackPositions: Number(form.moveBackPositions),
        notifyAtPosition: form.notifyAtPosition ? Number(form.notifyAtPosition) : undefined,
        clearNotifyAtPosition: !form.notifyAtPosition,
        notifyAtMinutes: form.notifyAtMinutes ? Number(form.notifyAtMinutes) : undefined,
        clearNotifyAtMinutes: !form.notifyAtMinutes,
        callStrategy,
      })
      setQueue(updated)
      setSaved(true)
    } catch (cause) {
      setError(errorMessage(t, cause))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!queueId) return
    try {
      await api.queues.remove(queueId)
      router.replace('/panel')
    } catch (cause) {
      setError(errorMessage(t, cause))
      setConfirmDelete(false)
    }
  }

  const refreshLanes = async () => {
    if (!queueId) return
    const lanes = await api.queues.lanes(queueId)
    setQueue((current) => current ? { ...current, lanes } : current)
  }

  const addLane = async () => {
    if (!queueId || !laneDraft.name.trim()) return
    setLaneBusy(true); setError(null); setLaneFeedback(null)
    try {
      await api.queues.createLane(queueId, { name: laneDraft.name.trim(), minPartySize: Number(laneDraft.minPartySize), maxPartySize: laneDraft.maxPartySize ? Number(laneDraft.maxPartySize) : null, priority: Number(laneDraft.priority), capacityMode: laneDraft.capacityMode, maxSize: laneDraft.maxSize ? Number(laneDraft.maxSize) : null, timeFactor: Number(laneDraft.timeFactor), active: true })
      setLaneDraft({ ...laneDraft, name: '' }); await refreshLanes()
      setLaneFeedback({ kind: 'info', message: t('lanes.added') })
    } catch (cause) { setLaneFeedback({ kind: 'error', message: errorMessage(t, cause) }) } finally { setLaneBusy(false) }
  }

  const toggleLane = async (lane: QueueLaneView) => {
    if (!queueId) return
    setLaneBusy(true); setError(null); setLaneFeedback(null)
    try {
      await api.queues.updateLane(queueId, lane.id, { name: lane.name, minPartySize: lane.minPartySize, maxPartySize: lane.maxPartySize ?? null, priority: lane.priority, capacityMode: lane.capacityMode, maxSize: lane.maxSize ?? null, timeFactor: lane.timeFactor, active: !lane.active })
      await refreshLanes()
      setLaneFeedback({ kind: 'info', message: t('lanes.toggled', { name: lane.name, state: lane.active ? t('lanes.stateOff') : t('lanes.stateOn') }) })
    } catch (cause) { setLaneFeedback({ kind: 'error', message: errorMessage(t, cause) }) } finally { setLaneBusy(false) }
  }

  const deleteLane = async (lane: QueueLaneView) => {
    if (!queueId) return
    setLaneBusy(true); setError(null); setLaneFeedback(null)
    try { await api.queues.removeLane(queueId, lane.id); await refreshLanes(); setLaneFeedback({ kind: 'info', message: t('lanes.deleted', { name: lane.name }) }) }
    catch (cause) { setLaneFeedback({ kind: 'error', message: errorMessage(t, cause) }) } finally { setLaneBusy(false) }
  }

  if (queueId === null) return <Alert kind="error">{t('board.noQueueSelected')}</Alert>
  if (!queue) return error ? <Alert kind="error">{error}</Alert> : <PageLoader label={t('settings.loading')} />

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <Link href={`/panel/queue?id=${queue.id}`} className="text-sm text-muted hover:text-ink">
          ← {t('settings.backToBoard')}
        </Link>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{queue.name}</h1>
        <p className="mt-1 text-sm text-muted">{t('settings.title')}</p>
      </header>

      {!isOwner ? (
        <Alert kind="info">{t('settings.ownerOnly')}</Alert>
      ) : null}

      <div className="xl:grid xl:grid-cols-[15rem_minmax(0,42rem)] xl:items-start xl:justify-center xl:gap-10">
        <aside className="hidden xl:block">
          <div className="sticky top-24 rounded-2xl border border-line bg-surface p-4 shadow-soft">
            <div className="border-b border-line pb-4">
              <p className="truncate font-display text-lg font-semibold">{queue.name}</p>
              <div className="mt-2"><Badge tone={queueStatusTone(queue.status)} dot>{queueStatusLabel(t, queue.status)}</Badge></div>
            </div>
            <nav aria-label={t('settings.title')} className="mt-4 space-y-1 text-sm">
              <SettingsNavLink href="#strategy">{t('lanes.strategyTitle')}</SettingsNavLink>
              <SettingsNavLink href="#basics">{t('settings.basics')}</SettingsNavLink>
              <SettingsNavLink href="#lanes">{t('lanes.title')}</SettingsNavLink>
              <SettingsNavLink href="#waiting-times">{t('settings.waitingTimes')}</SettingsNavLink>
              <SettingsNavLink href="#no-shows">{t('settings.noShowTitle')}</SettingsNavLink>
              <SettingsNavLink href="#notifications">{t('settings.notifications')}</SettingsNavLink>
            </nav>
            <div className="mt-5 space-y-2 border-t border-line pt-4">
              <Button type="button" block onClick={() => void save()} loading={saving} disabled={!isOwner}>{t('settings.save')}</Button>
              <Link href={`/panel/queue?id=${queue.id}`} className="block"><Button type="button" variant="ghost" block>{t('common.cancel')}</Button></Link>
              {error ? <p className="text-xs text-danger">{error}</p> : null}
              {saved ? <p className="text-xs text-sage">{t('settings.saved')}</p> : null}
            </div>
          </div>
        </aside>

        <div className="max-w-2xl space-y-6">
        <section id="strategy" className="scroll-mt-24">
          <Card>
            <CardHeader title={t('lanes.strategyTitle')} description={t('lanes.strategyHint')} />
            <SelectField
              label={t('lanes.strategyLabel')}
              value={callStrategy}
              onChange={(event) => {
                setCallStrategy(event.target.value as CallStrategy)
                setSaved(false)
              }}
            >
              <option value="GLOBAL_AGE">{t('lanes.strategyOldest')}</option>
              <option value="LANE_PRIORITY">{t('lanes.strategyPriority')}</option>
              <option value="ROUND_ROBIN">{t('lanes.strategyRoundRobin')}</option>
            </SelectField>
          </Card>
        </section>

        <section id="basics" className="scroll-mt-24"><Card>
          <CardHeader title={t('settings.basics')} />
          <div className="space-y-4">
            <Field label={t('panel.queueName')} value={form.name ?? ''} onChange={update('name')} maxLength={120} required />
            <Field
              label={t('panel.description')}
              optional
              value={form.description ?? ''}
              onChange={update('description')}
              maxLength={500}
            />
          </div>
        </Card></section>

        <section id="lanes" className="scroll-mt-24"><Card>
          <CardHeader title={t('lanes.title')} description={t('lanes.hint')} />
          <div className="space-y-3">
            {laneFeedback ? <Alert kind={laneFeedback.kind}>{laneFeedback.message}</Alert> : null}
            {(queue.lanes ?? []).map((lane) => (
              <div key={lane.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3 py-3">
                <div><p className="font-medium">{lane.name}</p><p className="text-xs text-muted">{lane.minPartySize}–{lane.maxPartySize ?? '∞'} {t('lanes.people')} · ×{lane.timeFactor}</p></div>
                <div className="flex gap-2"><Button type="button" size="sm" variant="ghost" loading={laneBusy} disabled={laneBusy || !isOwner} onClick={() => void toggleLane(lane)}>{lane.active ? t('lanes.disable') : t('lanes.enable')}</Button><Button type="button" size="sm" variant="ghost" disabled={laneBusy || lane.active || !isOwner} onClick={() => setLaneToDelete(lane)}>{t('lanes.delete')}</Button></div>
              </div>
            ))}
            <form onSubmit={(event) => { event.preventDefault(); void addLane() }} className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
              <Field label={t('lanes.name')} value={laneDraft.name} onChange={(e) => setLaneDraft({ ...laneDraft, name: e.target.value })} placeholder={t('lanes.namePlaceholder')} required />
              <Field label={t('lanes.min')} type="number" min={1} value={laneDraft.minPartySize} onChange={(e) => setLaneDraft({ ...laneDraft, minPartySize: e.target.value })} required />
              <Field label={t('lanes.max')} optional type="number" min={1} value={laneDraft.maxPartySize} onChange={(e) => setLaneDraft({ ...laneDraft, maxPartySize: e.target.value })} />
              <Field label={t('lanes.timeFactor')} type="number" min={0.1} step="any" value={laneDraft.timeFactor} onChange={(e) => setLaneDraft({ ...laneDraft, timeFactor: e.target.value })} hint={t('lanes.timeFactorHint')} required />
              <SelectField label={t('lanes.capacityMode')} value={laneDraft.capacityMode} onChange={(e) => setLaneDraft({ ...laneDraft, capacityMode: e.target.value as LaneCapacityMode })}><option value="GROUPS">{t('lanes.capacityGroups')}</option><option value="PERSONS">{t('lanes.capacityPersons')}</option></SelectField>
              <Field label={t('lanes.capacity')} optional type="number" min={1} value={laneDraft.maxSize} onChange={(e) => setLaneDraft({ ...laneDraft, maxSize: e.target.value })} />
              <Button type="submit" loading={laneBusy} disabled={!isOwner}>{t('lanes.add')}</Button>
            </form>
          </div>
        </Card></section>

        <section id="waiting-times" className="scroll-mt-24"><Card>
          <CardHeader
            title={t('settings.waitingTimes')}
            description={t('settings.waitingTimesHint')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('panel.servicePoints')}
              type="number"
              min={1}
              value={form.serviceStations ?? ''}
              onChange={update('serviceStations')}
              hint={t('settings.servicePointsHint')}
              required
            />
            <Field
              label={t('panel.typicalService')}
              type="number"
              min={1}
              value={form.defaultServiceMinutes ?? ''}
              onChange={update('defaultServiceMinutes')}
              hint={t('settings.typicalServiceHint')}
              required
            />
            <Field
              label={t('settings.maxSize')}
              optional
              type="number"
              min={1}
              value={form.maxSize ?? ''}
              onChange={update('maxSize')}
              hint={t('settings.maxSizeHint')}
            />
          </div>
        </Card></section>

        <section id="no-shows" className="scroll-mt-24"><Card>
          <CardHeader
            title={t('settings.noShowTitle')}
            description={t('settings.noShowHint')}
          />
          <div className="space-y-4">
            <Field
              label={t('settings.gracePeriod')}
              type="number"
              min={0}
              value={form.gracePeriodSeconds ?? ''}
              onChange={update('gracePeriodSeconds')}
              hint={t('settings.gracePeriodHint')}
              required
            />
            <SelectField
              label={t('settings.thenWhat')}
              value={policy}
              onChange={(event) => {
                setPolicy(event.target.value as NoShowPolicy)
                setSaved(false)
              }}
              hint={policyHelp(t)[policy]}
            >
              <option value="KEEP_POSITION">{t('settings.policyKeep')}</option>
              <option value="MOVE_BACK">{t('settings.policyMoveBack')}</option>
              <option value="MOVE_TO_END">{t('settings.policyMoveEnd')}</option>
              <option value="REMOVE">{t('settings.policyRemove')}</option>
            </SelectField>
            {policy === 'MOVE_BACK' ? (
              <Field
                label={t('settings.placesBack')}
                type="number"
                min={1}
                value={form.moveBackPositions ?? ''}
                onChange={update('moveBackPositions')}
                required
              />
            ) : null}
          </div>
        </Card></section>

        <section id="notifications" className="scroll-mt-24"><Card>
          <CardHeader
            title={t('settings.notifications')}
            description={t('settings.notificationsHint')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('settings.notifyPosition')}
              optional
              type="number"
              min={1}
              value={form.notifyAtPosition ?? ''}
              onChange={update('notifyAtPosition')}
              hint={t('settings.notifyPositionHint')}
            />
            <Field
              label={t('settings.notifyMinutes')}
              optional
              type="number"
              min={1}
              value={form.notifyAtMinutes ?? ''}
              onChange={update('notifyAtMinutes')}
              hint={t('settings.notifyMinutesHint')}
            />
          </div>
        </Card></section>

        {error ? <Alert kind="error">{error}</Alert> : null}
        {saved ? <Alert kind="success">{t('settings.saved')}</Alert> : null}

        <div className="flex items-center gap-3 xl:hidden">
          <Button type="button" onClick={() => void save()} loading={saving} disabled={!isOwner}>
            {t('settings.save')}
          </Button>
          <Link href={`/panel/queue?id=${queue.id}`}>
            <Button type="button" variant="ghost">
              {t('common.cancel')}
            </Button>
          </Link>
        </div>
        {isOwner ? (
          <Card className="border-danger/25">
            <CardHeader
              title={t('settings.deleteTitle')}
              description={t('settings.deleteHint')}
            />
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t('settings.delete')}
            </Button>
          </Card>
        ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('settings.confirmDeleteTitle', { name: queue.name })}
        description={t('settings.confirmDeleteBody')}
        confirmLabel={t('settings.delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={laneToDelete !== null}
        title={t('lanes.confirmDeleteTitle')}
        description={laneToDelete ? `“${laneToDelete.name}” can only be deleted once it is disabled and has no active entries.` : ''}
        confirmLabel={t('lanes.confirmDelete')}
        destructive
        onConfirm={() => {
          if (laneToDelete) void deleteLane(laneToDelete)
          setLaneToDelete(null)
        }}
        onCancel={() => setLaneToDelete(null)}
      />
    </div>
  )
}

function SettingsNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} className="block rounded-lg px-3 py-2 text-muted transition-colors hover:bg-raised hover:text-ink">{children}</a>
}
