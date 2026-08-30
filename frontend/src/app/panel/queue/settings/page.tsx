'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useQueryParam } from '@/lib/usePathSegment'
import type { NoShowPolicy, QueueView } from '@/lib/types'
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
  const [requirePartySize, setRequirePartySize] = useState(false)
  const [policy, setPolicy] = useState<NoShowPolicy>('MOVE_TO_END')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!queueId) return
    api.queues.get(queueId).then(
      (loaded) => {
        setQueue(loaded)
        setPolicy(loaded.noShowPolicy)
        setRequirePartySize(loaded.requirePartySize)
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

  const save = async (event: FormEvent) => {
    event.preventDefault()
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
        requirePartySize,
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

      <form onSubmit={save} className="space-y-6">
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
            <div className="flex items-center">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={requirePartySize}
                  onChange={(event) => {
                    setRequirePartySize(event.target.checked)
                    setSaved(false)
                  }}
                  className="mt-0.5 size-4 accent-[var(--color-brand)]"
                />
                <span>
                  <span className="text-sm font-medium">Ask how many people</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Useful for tables; unnecessary at a counter.
                  </span>
                </span>
              </label>
            </div>
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
              label="When this many are ahead"
              optional
              type="number"
              min={1}
              value={form.notifyAtPosition ?? ''}
              onChange={update('notifyAtPosition')}
              hint="e.g. 3 — warn once only three people are in front."
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
          <Button type="submit" loading={saving} disabled={!isOwner}>
            Save changes
          </Button>
          <Link href={`/panel/queue?id=${queue.id}`}>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
        </div>
      </form>

      {isOwner ? (
        <Card className="border-danger/25">
          <CardHeader
            title="Delete this queue"
            description="Removes the queue, its QR code and its whole history. This cannot be undone."
          />
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete queue
          </Button>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${queue.name}"?`}
        description="The QR code stops working and every ticket and metric for this queue is removed."
        confirmLabel="Delete queue"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
