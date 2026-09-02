'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useQueryParam } from '@/lib/usePathSegment'
import type { CallStrategy, LaneCapacityMode, NoShowPolicy, QueueLaneView, QueueView } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field, SelectField } from '@/components/ui/Field'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageLoader } from '@/components/PageLoader'

const POLICY_HELP: Record<NoShowPolicy, string> = {
  KEEP_POSITION: 'They keep the exact place they had. The most forgiving option.',
  MOVE_BACK: 'They drop a few places, so the people right behind them are not held up.',
  MOVE_TO_END: 'They go to the back of the line and start their wait again.',
  REMOVE: 'They lose their place entirely and have to rejoin.',
}

/** Everything about how a queue behaves. Owner-only; the API enforces that too. */
export default function QueueSettingsPage() {
  const router = useRouter()
  const queueId = useQueryParam('id')
  const { isOwner } = useAuth()

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
      (cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Something went wrong.'),
    )
  }, [queueId])

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
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong.')
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
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong.')
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
      setLaneFeedback({ kind: 'info', message: 'Lane added and enabled.' })
    } catch (cause) { setLaneFeedback({ kind: 'error', message: cause instanceof ApiError ? cause.message : 'Could not add this lane.' }) } finally { setLaneBusy(false) }
  }

  const toggleLane = async (lane: QueueLaneView) => {
    if (!queueId) return
    setLaneBusy(true); setError(null); setLaneFeedback(null)
    try {
      await api.queues.updateLane(queueId, lane.id, { name: lane.name, minPartySize: lane.minPartySize, maxPartySize: lane.maxPartySize ?? null, priority: lane.priority, capacityMode: lane.capacityMode, maxSize: lane.maxSize ?? null, timeFactor: lane.timeFactor, active: !lane.active })
      await refreshLanes()
      setLaneFeedback({ kind: 'info', message: `${lane.name} ${lane.active ? 'disabled' : 'enabled'}.` })
    } catch (cause) { setLaneFeedback({ kind: 'error', message: cause instanceof ApiError ? cause.message : 'Could not update this lane.' }) } finally { setLaneBusy(false) }
  }

  const deleteLane = async (lane: QueueLaneView) => {
    if (!queueId) return
    setLaneBusy(true); setError(null); setLaneFeedback(null)
    try { await api.queues.removeLane(queueId, lane.id); await refreshLanes(); setLaneFeedback({ kind: 'info', message: `${lane.name} deleted.` }) }
    catch (cause) { setLaneFeedback({ kind: 'error', message: cause instanceof ApiError ? cause.message : 'Could not delete this lane.' }) } finally { setLaneBusy(false) }
  }

  if (queueId === null) return <Alert kind="error">No queue selected.</Alert>
  if (!queue) return error ? <Alert kind="error">{error}</Alert> : <PageLoader label="Loading settings" />

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link href={`/panel/queue?id=${queue.id}`} className="text-sm text-muted hover:text-ink">
          ← Back to the board
        </Link>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{queue.name}</h1>
        <p className="mt-1 text-sm text-muted">Settings</p>
      </header>

      {!isOwner ? (
        <Alert kind="info">Only the owner of this establishment can change these settings.</Alert>
      ) : null}

      <div className="space-y-6">
        <Card>
          <CardHeader title="Call strategy" description="Controls which lane the global Call next button chooses." />
          <SelectField label="Global calls" value={callStrategy} onChange={(e) => setCallStrategy(e.target.value as CallStrategy)}>
            <option value="GLOBAL_AGE">Oldest ticket overall</option>
            <option value="LANE_PRIORITY">Highest-priority active lane</option>
            <option value="ROUND_ROBIN">Round robin between lanes</option>
          </SelectField>
        </Card>

        <Card>
          <CardHeader title="Basics" />
          <div className="space-y-4">
            <Field label="Name" value={form.name ?? ''} onChange={update('name')} maxLength={120} required />
            <Field
              label="Description"
              optional
              value={form.description ?? ''}
              onChange={update('description')}
              maxLength={500}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Group-size lanes" description="Customers are assigned automatically by party size. Active ranges cannot overlap. Time factor adjusts each lane's ETA relative to the base service time." />
          <div className="space-y-3">
            {laneFeedback ? <Alert kind={laneFeedback.kind}>{laneFeedback.message}</Alert> : null}
            {(queue.lanes ?? []).map((lane) => (
              <div key={lane.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3 py-3">
                <div><p className="font-medium">{lane.name}</p><p className="text-xs text-muted">{lane.minPartySize}–{lane.maxPartySize ?? '∞'} people · {lane.capacityMode.toLowerCase()} · ×{lane.timeFactor}</p></div>
                <div className="flex gap-2"><Button type="button" size="sm" variant="ghost" loading={laneBusy} disabled={laneBusy || !isOwner} onClick={() => void toggleLane(lane)}>{lane.active ? 'Disable' : 'Enable'}</Button><Button type="button" size="sm" variant="ghost" disabled={laneBusy || lane.active || !isOwner} onClick={() => setLaneToDelete(lane)}>Delete</Button></div>
              </div>
            ))}
            <form onSubmit={(event) => { event.preventDefault(); void addLane() }} className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
              <Field label="Lane name" value={laneDraft.name} onChange={(e) => setLaneDraft({ ...laneDraft, name: e.target.value })} placeholder="1–2 people" required />
              <Field label="Minimum people" type="number" min={1} value={laneDraft.minPartySize} onChange={(e) => setLaneDraft({ ...laneDraft, minPartySize: e.target.value })} required />
              <Field label="Maximum people" optional type="number" min={1} value={laneDraft.maxPartySize} onChange={(e) => setLaneDraft({ ...laneDraft, maxPartySize: e.target.value })} />
              <Field label="Time factor" type="number" min={0.001} step={0.1} value={laneDraft.timeFactor} onChange={(e) => setLaneDraft({ ...laneDraft, timeFactor: e.target.value })} hint="Multiplier applied to this lane's ETA: 1.0 = base time, 1.5 = 50% longer, 0.5 = half the time." required />
              <SelectField label="Capacity counts" value={laneDraft.capacityMode} onChange={(e) => setLaneDraft({ ...laneDraft, capacityMode: e.target.value as LaneCapacityMode })}><option value="GROUPS">Groups</option><option value="PERSONS">People</option></SelectField>
              <Field label="Lane capacity" optional type="number" min={1} value={laneDraft.maxSize} onChange={(e) => setLaneDraft({ ...laneDraft, maxSize: e.target.value })} />
              <Button type="submit" loading={laneBusy} disabled={!isOwner}>Add lane</Button>
            </form>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Waiting times"
            description="These two numbers decide every estimate a customer is shown."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Service points"
              type="number"
              min={1}
              value={form.serviceStations ?? ''}
              onChange={update('serviceStations')}
              hint="People you can serve at the same time."
              required
            />
            <Field
              label="Typical service time"
              type="number"
              min={1}
              value={form.defaultServiceMinutes ?? ''}
              onChange={update('defaultServiceMinutes')}
              hint="Minutes. Only used until real services are measured."
              required
            />
            <Field
              label="Maximum queue size"
              optional
              type="number"
              min={1}
              value={form.maxSize ?? ''}
              onChange={update('maxSize')}
              hint="Leave empty for no limit."
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="When someone doesn't show up"
            description="After you call a customer, they get a grace period to arrive."
          />
          <div className="space-y-4">
            <Field
              label="Grace period"
              type="number"
              min={0}
              value={form.gracePeriodSeconds ?? ''}
              onChange={update('gracePeriodSeconds')}
              hint="Seconds. Use 0 if you'd rather decide yourself, with no automatic no-shows."
              required
            />
            <SelectField
              label="Then what happens"
              value={policy}
              onChange={(event) => {
                setPolicy(event.target.value as NoShowPolicy)
                setSaved(false)
              }}
              hint={POLICY_HELP[policy]}
            >
              <option value="KEEP_POSITION">Keep their place</option>
              <option value="MOVE_BACK">Move them back a few places</option>
              <option value="MOVE_TO_END">Move them to the end</option>
              <option value="REMOVE">Remove them from the queue</option>
            </SelectField>
            {policy === 'MOVE_BACK' ? (
              <Field
                label="How many places back"
                type="number"
                min={1}
                value={form.moveBackPositions ?? ''}
                onChange={update('moveBackPositions')}
                required
              />
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Notifications"
            description="When to warn a customer that their turn is coming. Leave either one empty to switch it off."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="When this many groups are scheduled before them"
              optional
              type="number"
              min={1}
              value={form.notifyAtPosition ?? ''}
              onChange={update('notifyAtPosition')}
              hint="e.g. 3 — warn once the configured call strategy schedules only three groups before them."
            />
            <Field
              label="When this close in minutes"
              optional
              type="number"
              min={1}
              value={form.notifyAtMinutes ?? ''}
              onChange={update('notifyAtMinutes')}
              hint="e.g. 10 — warn once the estimate drops to ten minutes."
            />
          </div>
        </Card>

        {error ? <Alert kind="error">{error}</Alert> : null}
        {saved ? <Alert kind="success">Settings saved.</Alert> : null}

        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => void save()} loading={saving} disabled={!isOwner}>
            Save changes
          </Button>
          <Link href={`/panel/queue?id=${queue.id}`}>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
        </div>
      </div>

      {isOwner ? (
        <Card className="border-danger/25">
          <CardHeader
            title="Delete this queue"
            description="Archives the queue. Its QR code stops accepting entries, while tickets and history are preserved."
          />
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Archive queue
          </Button>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={`Archive "${queue.name}"?`}
        description="The queue will stop accepting entries. Existing tickets, events and metrics will be preserved."
        confirmLabel="Archive queue"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={laneToDelete !== null}
        title="Delete this lane?"
        description={laneToDelete ? `“${laneToDelete.name}” can only be deleted once it is disabled and has no active entries.` : ''}
        confirmLabel="Delete lane"
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
