'use client'

import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { cx, errorMessage, formatMinutes, formatPercent } from '@/lib/format'
import type { AnalyticsDashboard, AnalyticsDay, AnalyticsHeatCell, AnalyticsRange } from '@/lib/types'
import { Alert } from '@/components/ui/Alert'
import { ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/EmptyState'
import { PageLoader } from '@/components/PageLoader'
import { Stat } from '@/components/Stat'

const RANGES: AnalyticsRange[] = ['LAST_30_DAYS', 'LAST_90_DAYS']

/**
 * The historical dashboard. Today's numbers live on the panel home and come from the operational
 * table; these come from the data lake, one row per finished visit, over weeks.
 */
export default function AnalyticsPage() {
  const { activeEstablishment } = useAuth()
  const { t, locale } = useI18n()
  const establishmentId = activeEstablishment?.id ?? null

  const [range, setRange] = useState<AnalyticsRange>('LAST_30_DAYS')
  const [dashboard, setDashboard] = useState<AnalyticsDashboard | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!establishmentId) return
    // A slow 90-day answer must not overwrite the 30-day one the operator switched back to.
    let cancelled = false
    setLoading(true)
    api.establishments
      .analytics(establishmentId, range)
      .then((result) => {
        if (cancelled) return
        setDashboard(result)
        setUnavailable(false)
        setError(null)
      })
      .catch((cause) => {
        if (cancelled) return
        if (cause instanceof ApiError && cause.code === 'ANALYTICS_UNAVAILABLE') setUnavailable(true)
        else setError(errorMessage(t, cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [establishmentId, range, t])

  const day = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }), [locale])
  const formatDay = (date: string) => day.format(new Date(`${date}T12:00:00Z`))

  if (!activeEstablishment) return <PageLoader label={t('panel.loadingEstablishment')} />

  const summary = dashboard?.summary

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t('analytics.title')}</h1>
          <p className="mt-1 text-sm text-muted">
            {dashboard
              ? t('analytics.subtitle', { from: formatDay(dashboard.from), to: formatDay(dashboard.to) })
              : activeEstablishment.name}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div role="group" aria-label={t('analytics.range')} className="inline-flex rounded-xl border border-line-strong bg-surface p-1">
            {RANGES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={range === option}
                onClick={() => setRange(option)}
                className={cx(
                  'h-8 rounded-lg px-3 text-sm font-medium transition-colors',
                  range === option ? 'bg-brand text-on-brand' : 'text-muted hover:text-ink',
                )}
              >
                {t(`analytics.${option}`)}
              </button>
            ))}
          </div>
          <ButtonLink href="/panel" variant="ghost" size="sm">
            {t('analytics.back')}
          </ButtonLink>
        </div>
      </section>

      {error ? <Alert kind="error">{error}</Alert> : null}

      {unavailable ? (
        <EmptyState title={t('analytics.unavailableTitle')} description={t('analytics.unavailableBody')} />
      ) : !dashboard ? (
        loading ? <PageLoader label={t('analytics.loading')} /> : null
      ) : dashboard.summary.visits === 0 ? (
        <EmptyState title={t('analytics.emptyTitle')} description={t('analytics.emptyBody')} />
      ) : (
        <div className={cx('space-y-6 transition-opacity', loading && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat
              label={t('analytics.visits')}
              value={summary!.visits.toLocaleString(locale)}
              hint={t('analytics.visitsHint', { served: summary!.served.toLocaleString(locale) })}
              emphasis
            />
            <Stat
              label={t('analytics.averageWait')}
              value={formatMinutes(summary!.averageWaitMinutes)}
              hint={summary!.p90WaitMinutes !== undefined ? t('analytics.p90Hint', { minutes: formatMinutes(summary!.p90WaitMinutes) }) : undefined}
            />
            <Stat
              label={t('analytics.estimateError')}
              value={summary!.estimateErrorMinutes !== undefined ? `±${formatMinutes(summary!.estimateErrorMinutes)}` : '—'}
              hint={summary!.estimateHitRate !== undefined ? t('analytics.estimateHint', { rate: formatPercent(summary!.estimateHitRate) }) : undefined}
            />
            <Stat
              label={t('analytics.abandonment')}
              value={formatPercent(summary!.abandonmentRate)}
              hint={t('analytics.ofVisits', { count: summary!.left, total: summary!.visits })}
            />
            <Stat
              label={t('analytics.noShows')}
              value={formatPercent(summary!.noShowRate)}
              hint={t('analytics.ofVisits', { count: summary!.noShows, total: summary!.visits })}
            />
          </div>

          <Card>
            <CardHeader title={t('analytics.dailyTitle')} description={t('analytics.dailyHint')} />
            <DailyChart days={dashboard.daily} formatDay={formatDay} />
          </Card>

          <Card>
            <CardHeader title={t('analytics.heatmapTitle')} description={t('analytics.heatmapHint')} />
            <Heatmap cells={dashboard.heatmap} />
          </Card>

          <Card>
            <CardHeader title={t('analytics.queuesTitle')} />
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-1 py-2 font-medium">{t('analytics.queue')}</th>
                    <th className="px-1 py-2 text-right font-medium">{t('analytics.visits')}</th>
                    <th className="px-1 py-2 text-right font-medium">{t('analytics.averageWait')}</th>
                    <th className="px-1 py-2 text-right font-medium">{t('analytics.p90Wait')}</th>
                    <th className="px-1 py-2 text-right font-medium">{t('analytics.abandonment')}</th>
                    <th className="px-1 py-2 text-right font-medium">{t('analytics.noShows')}</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {dashboard.queues.map((queue) => (
                    <tr key={queue.queueId} className="border-b border-line last:border-0">
                      <td className="px-1 py-2.5 font-medium">{queue.name}</td>
                      <td className="px-1 py-2.5 text-right">{queue.visits.toLocaleString(locale)}</td>
                      <td className="px-1 py-2.5 text-right">{formatMinutes(queue.averageWaitMinutes)}</td>
                      <td className="px-1 py-2.5 text-right">{formatMinutes(queue.p90WaitMinutes)}</td>
                      <td className="px-1 py-2.5 text-right">{formatPercent(queue.abandonmentRate)}</td>
                      <td className="px-1 py-2.5 text-right">{formatPercent(queue.noShowRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {dashboard.dataUntil ? (
            <p className="text-xs text-faint">
              {t('analytics.dataUntil', {
                when: new Date(dashboard.dataUntil).toLocaleString(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: dashboard.timezone,
                }),
              })}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** One thin column per day, a readout line above that follows the pointer, and a table behind a toggle. */
function DailyChart({ days, formatDay }: { days: AnalyticsDay[]; formatDay: (date: string) => string }) {
  const { t, locale } = useI18n()
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...days.map((day) => day.visits))
  // Three recessive gridlines at round numbers.
  const step = niceStep(max / 3)
  const ticks = [step, step * 2, step * 3].filter((tick) => tick <= max * 1.05)
  const top = Math.max(max, ticks.at(-1) ?? max)
  const shown = active === null ? null : days[active]
  const readout = (day: AnalyticsDay) =>
    t('analytics.dayReadout', {
      date: formatDay(day.date),
      visits: day.visits,
      served: day.served,
      wait: formatMinutes(day.averageWaitMinutes),
    })

  return (
    <div>
      <p className="mb-3 h-5 truncate text-sm text-muted tnum" aria-live="polite">
        {shown ? readout(shown) : t('analytics.hoverHint')}
      </p>
      <div className="relative h-48 pl-9">
        {ticks.map((tick) => (
          <div key={tick} className="absolute inset-x-0 border-t border-line" style={{ bottom: `${(tick / top) * 100}%` }}>
            <span className="absolute -top-2 left-0 text-[0.7rem] text-faint tnum">{tick.toLocaleString(locale)}</span>
          </div>
        ))}
        <div className="absolute inset-y-0 left-9 right-0 border-b border-line-strong" />
        <div className="relative flex h-full items-end gap-[2px]" onMouseLeave={() => setActive(null)}>
          {days.map((day, index) => (
            <button
              key={day.date}
              type="button"
              aria-label={readout(day)}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              // The hit target is the whole column, taller than the bar it holds.
              className="group flex h-full min-w-0 flex-1 items-end focus:outline-none"
            >
              <span
                className={cx(
                  'block w-full max-w-6 mx-auto rounded-t-[4px] bg-brand transition-opacity',
                  active !== null && active !== index ? 'opacity-45' : 'opacity-100',
                  'group-focus-visible:ring-2 group-focus-visible:ring-ink',
                )}
                style={{ height: `${(day.visits / top) * 100}%` }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-9 text-[0.7rem] text-faint tnum">
        <span>{days[0] ? formatDay(days[0].date) : ''}</span>
        <span>{days.at(-1) ? formatDay(days.at(-1)!.date) : ''}</span>
      </div>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted hover:text-ink">{t('analytics.showTable')}</summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="w-full text-sm tnum">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-1.5 font-medium">{t('analytics.date')}</th>
                <th className="py-1.5 text-right font-medium">{t('analytics.visits')}</th>
                <th className="py-1.5 text-right font-medium">{t('analytics.served')}</th>
                <th className="py-1.5 text-right font-medium">{t('analytics.averageWait')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date} className="border-b border-line last:border-0">
                  <td className="py-1.5">{formatDay(day.date)}</td>
                  <td className="py-1.5 text-right">{day.visits}</td>
                  <td className="py-1.5 text-right">{day.served}</td>
                  <td className="py-1.5 text-right">{formatMinutes(day.averageWaitMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

/** Five steps of the brand hue, light to dark. Mixed against the surface, so dark mode re-points itself. */
const HEAT_STEPS = [12, 30, 50, 72, 100]

function Heatmap({ cells }: { cells: AnalyticsHeatCell[] }) {
  const { t, locale } = useI18n()
  const [active, setActive] = useState<AnalyticsHeatCell | null>(null)

  const byKey = new Map(cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell.visits]))
  const busy = cells.filter((cell) => cell.visits > 0)
  // Only the hours the business is open: the span from the first to the last hour with arrivals.
  const firstHour = busy.length ? Math.min(...busy.map((cell) => cell.hour)) : 0
  const lastHour = busy.length ? Math.max(...busy.map((cell) => cell.hour)) : 23
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index)
  const max = Math.max(1, ...cells.map((cell) => cell.visits))

  // 2024-01-01 was a Monday: weekday n is that date plus n - 1 days.
  const weekdayName = (weekday: number) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, weekday)))
  const readout = (weekday: number, hour: number, visits: number) =>
    t('analytics.cellReadout', { weekday: weekdayName(weekday), hour: String(hour).padStart(2, '0'), visits })
  const fill = (visits: number) => {
    if (visits === 0) return 'var(--color-raised)'
    const step = HEAT_STEPS[Math.min(HEAT_STEPS.length - 1, Math.floor((visits / max) * HEAT_STEPS.length))]
    return `color-mix(in oklab, var(--color-brand) ${step}%, var(--color-surface))`
  }

  return (
    <div>
      <p className="mb-3 h-5 truncate text-sm text-muted tnum" aria-live="polite">
        {active ? readout(active.weekday, active.hour, active.visits) : t('analytics.hoverHint')}
      </p>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[28rem] gap-[2px]"
          style={{ gridTemplateColumns: `2.5rem repeat(${hours.length}, minmax(0, 1fr))` }}
          onMouseLeave={() => setActive(null)}
        >
          <span />
          {hours.map((hour) => (
            <span key={hour} className="pb-1 text-center text-[0.7rem] text-faint tnum">
              {String(hour).padStart(2, '0')}
            </span>
          ))}
          {[1, 2, 3, 4, 5, 6, 7].map((weekday) => (
            <div key={weekday} className="contents">
              <span className="flex items-center text-xs text-muted">{weekdayName(weekday)}</span>
              {hours.map((hour) => {
                const visits = byKey.get(`${weekday}:${hour}`) ?? 0
                const cell = { weekday, hour, visits }
                return (
                  <button
                    key={hour}
                    type="button"
                    aria-label={readout(weekday, hour, visits)}
                    onMouseEnter={() => setActive(cell)}
                    onFocus={() => setActive(cell)}
                    onBlur={() => setActive(null)}
                    className={cx(
                      'h-7 rounded-[4px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink',
                      active && active.weekday === weekday && active.hour === hour && 'ring-2 ring-ink',
                    )}
                    style={{ background: fill(visits) }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-[0.7rem] text-faint">
        <span>{t('analytics.fewer')}</span>
        {HEAT_STEPS.map((step) => (
          <span
            key={step}
            className="h-3 w-5 rounded-[3px]"
            style={{ background: `color-mix(in oklab, var(--color-brand) ${step}%, var(--color-surface))` }}
          />
        ))}
        <span>{t('analytics.more')}</span>
      </div>
    </div>
  )
}

/** A gridline step that reads as a round number: 1, 2 or 5 times a power of ten. */
function niceStep(raw: number): number {
  if (raw <= 1) return 1
  const power = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / power
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power
}
