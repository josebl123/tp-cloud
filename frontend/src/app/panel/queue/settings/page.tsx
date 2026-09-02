'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n, type Translate } from '@/lib/i18n'
import { useQueryParam } from '@/lib/usePathSegment'
import type { NoShowPolicy, QueueView } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
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
      (cause: unknown) => setError(cause instanceof ApiError ? cause.message : t('common.somethingWrong')),
    )
  }, [queueId, t])

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
      setError(cause instanceof ApiError ? cause.message : t('common.somethingWrong'))
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
      setError(cause instanceof ApiError ? cause.message : t('common.somethingWrong'))
      setConfirmDelete(false)
    }
  }

  if (queueId === null) return <Alert kind="error">{t('board.noQueueSelected')}</Alert>
  if (!queue) return error ? <Alert kind="error">{error}</Alert> : <PageLoader label={t('settings.loading')} />

  return (
    <div className="mx-auto max-w-2xl space-y-6">
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

      <form onSubmit={save} className="space-y-6">
        <Card>
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
        </Card>

        <Card>
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
                  <span className="text-sm font-medium">{t('settings.askPartySize')}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {t('settings.askPartySizeHint')}
                  </span>
                </span>
              </label>
            </div>
          </div>
        </Card>

        <Card>
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
        </Card>

        <Card>
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
        </Card>

        {error ? <Alert kind="error">{error}</Alert> : null}
        {saved ? <Alert kind="success">{t('settings.saved')}</Alert> : null}

        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving} disabled={!isOwner}>
            {t('settings.save')}
          </Button>
          <Link href={`/panel/queue?id=${queue.id}`}>
            <Button type="button" variant="ghost">
              {t('common.cancel')}
            </Button>
          </Link>
        </div>
      </form>

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

      <ConfirmDialog
        open={confirmDelete}
        title={t('settings.confirmDeleteTitle', { name: queue.name })}
        description={t('settings.confirmDeleteBody')}
        confirmLabel={t('settings.delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
