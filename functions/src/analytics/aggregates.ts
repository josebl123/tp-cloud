// Los agregados diarios: lo que Athena calcula sobre el data lake y DynamoDB sirve al tablero.
//
// Athena tarda segundos en responder y cobra por dato escaneado: está bien para calcular, no para
// atender cada vez que alguien abre el panel. Así que se separan las dos cosas:
//
//   - cada tanto, λ analytics-refresher le pide a Athena un resumen por local, día y cola, y lo guarda
//     en DynamoDB (una fila por local y día);
//   - la ruta del tablero lee los días del rango de DynamoDB, en milisegundos, y los combina acá.
//
// Para poder combinar días, cada uno guarda sumas, conteos e histogramas, nunca promedios ni
// percentiles: el promedio de 30 promedios no es el promedio del mes, y el p90 de un mes no sale de
// los p90 de cada día. Sí sale de sumar los histogramas de espera de cada día.

import type { AnalyticsFigures, AnalyticsHeatCell, AnalyticsQueue, AnalyticsSummary } from './dashboard.js'
import { addDays } from './dashboard.js'

/** Las esperas se cuentan por minuto entero; todo lo que pase de este tope cae en el último. */
export const WAIT_HISTOGRAM_CAP_MINUTES = 240
/** Una estimación "acierta" si erró por esto o menos. */
export const ESTIMATE_HIT_SECONDS = 300

/** Lo que pasó en una cola durante un día local. Solo sumas y conteos: se pueden sumar entre días. */
export interface QueueDay {
  name: string
  visits: number
  served: number
  left: number
  noShows: number
  waitSum: number
  waitCount: number
  serviceSum: number
  serviceCount: number
  partySum: number
  estimateErrorSum: number
  estimateCount: number
  estimateHits: number
  /** Minutos de espera → cuántos llamados esperaron eso. */
  waitHistogram: Record<string, number>
  /** `día de la semana * 100 + hora` local de llegada → cuántas llegadas. */
  arrivals: Record<string, number>
  /** El fin más reciente de una visita de ese día, en ms desde 1970. */
  lastFinished: number
}

export interface DailyAggregate {
  establishmentId: string
  /** Día local en que terminaron las visitas, AAAA-MM-DD. */
  date: string
  queues: Record<string, QueueDay>
}

// -------------------------------------------------------------------------------------- la consulta

const DATE = /^\d{4}-\d{2}-\d{2}$/
const IDENTIFIER = /^[a-z0-9_]+$/

/**
 * La consulta de Athena: los agregados de cada local, día y cola desde `since`.
 *
 * Primero deja una fila por visita: Firehose entrega al menos una vez y el historial de demo se
 * puede recargar, así que un mismo `visit_id` puede estar repetido; gana el que terminó último (una
 * visita que volvió a la fila y terminó de nuevo). El filtro por `dt` es sobre la partición: Athena
 * solo abre las carpetas de esos días.
 */
export function aggregatesQuery(database: string, table: string, since: string): string {
  if (!IDENTIFIER.test(database) || !IDENTIFIER.test(table)) throw new Error('Nombre de base o tabla inválido')
  if (!DATE.test(since)) throw new Error(`Fecha inválida: ${since}`)
  return `
WITH ranked AS (
  SELECT *, row_number() OVER (PARTITION BY visit_id ORDER BY finished_at DESC) AS copy_rank
  FROM "${database}"."${table}"
  WHERE dt >= '${since}'
),
visits AS (SELECT * FROM ranked WHERE copy_rank = 1)
SELECT
  establishment_id,
  dt,
  queue_id,
  max_by(queue_name, finished_at) AS queue_name,
  count(*) AS visits,
  count_if(outcome = 'SERVED') AS served,
  count_if(outcome = 'LEFT') AS left_count,
  count_if(outcome = 'NO_SHOW') AS no_shows,
  coalesce(sum(wait_seconds), 0) AS wait_sum,
  count(wait_seconds) AS wait_count,
  coalesce(sum(service_seconds), 0) AS service_sum,
  count(service_seconds) AS service_count,
  sum(party_size) AS party_sum,
  coalesce(sum(abs(estimated_wait_seconds - wait_seconds)), 0) AS estimate_error_sum,
  count(estimated_wait_seconds - wait_seconds) AS estimate_count,
  count_if(abs(estimated_wait_seconds - wait_seconds) <= ${ESTIMATE_HIT_SECONDS}) AS estimate_hits,
  json_format(CAST(histogram(least(wait_seconds / 60, ${WAIT_HISTOGRAM_CAP_MINUTES})) AS JSON)) AS wait_histogram,
  json_format(CAST(histogram(local_weekday * 100 + local_hour) AS JSON)) AS arrivals,
  CAST(to_unixtime(max(finished_at)) * 1000 AS bigint) AS last_finished
FROM visits
GROUP BY establishment_id, dt, queue_id
`.trim()
}

/** Las columnas de la consulta, en orden. `parseRows` las busca por nombre, no por posición. */
const COLUMNS = [
  'establishment_id', 'dt', 'queue_id', 'queue_name', 'visits', 'served', 'left_count', 'no_shows',
  'wait_sum', 'wait_count', 'service_sum', 'service_count', 'party_sum', 'estimate_error_sum',
  'estimate_count', 'estimate_hits', 'wait_histogram', 'arrivals', 'last_finished',
] as const

/**
 * Las filas que devuelve Athena (todo texto, la primera es el encabezado) agrupadas por local y día.
 * Un histograma vacío llega como texto vacío o `null`.
 */
export function parseRows(rows: readonly (readonly (string | undefined)[])[]): DailyAggregate[] {
  const [header, ...data] = rows
  if (!header) return []
  const index = Object.fromEntries(COLUMNS.map((column) => [column, header.indexOf(column)]))
  const missing = COLUMNS.filter((column) => index[column] === -1)
  if (missing.length) throw new Error(`Faltan columnas en el resultado: ${missing.join(', ')}`)

  const days = new Map<string, DailyAggregate>()
  for (const row of data) {
    const text = (column: (typeof COLUMNS)[number]) => row[index[column]!] ?? ''
    const number = (column: (typeof COLUMNS)[number]) => Number(text(column) || 0)
    const counts = (column: (typeof COLUMNS)[number]): Record<string, number> => {
      const raw = text(column)
      return raw && raw !== 'null' ? (JSON.parse(raw) as Record<string, number>) : {}
    }
    const establishmentId = text('establishment_id')
    const date = text('dt')
    const key = `${establishmentId}|${date}`
    const day = days.get(key) ?? { establishmentId, date, queues: {} }
    day.queues[text('queue_id')] = {
      name: text('queue_name'),
      visits: number('visits'),
      served: number('served'),
      left: number('left_count'),
      noShows: number('no_shows'),
      waitSum: number('wait_sum'),
      waitCount: number('wait_count'),
      serviceSum: number('service_sum'),
      serviceCount: number('service_count'),
      partySum: number('party_sum'),
      estimateErrorSum: number('estimate_error_sum'),
      estimateCount: number('estimate_count'),
      estimateHits: number('estimate_hits'),
      waitHistogram: counts('wait_histogram'),
      arrivals: counts('arrivals'),
      lastFinished: number('last_finished'),
    }
    days.set(key, day)
  }
  return [...days.values()]
}

// ----------------------------------------------------------------------------------- la combinación

const emptyQueueDay = (name: string): QueueDay => ({
  name,
  visits: 0,
  served: 0,
  left: 0,
  noShows: 0,
  waitSum: 0,
  waitCount: 0,
  serviceSum: 0,
  serviceCount: 0,
  partySum: 0,
  estimateErrorSum: 0,
  estimateCount: 0,
  estimateHits: 0,
  waitHistogram: {},
  arrivals: {},
  lastFinished: 0,
})

const addCounts = (into: Record<string, number>, from: Record<string, number>) => {
  for (const [key, count] of Object.entries(from)) into[key] = (into[key] ?? 0) + count
}

/** Suma dos días (o un acumulado y un día). El nombre que queda es el del más reciente. */
function merge(into: QueueDay, day: QueueDay): void {
  if (day.lastFinished >= into.lastFinished) into.name = day.name
  into.visits += day.visits
  into.served += day.served
  into.left += day.left
  into.noShows += day.noShows
  into.waitSum += day.waitSum
  into.waitCount += day.waitCount
  into.serviceSum += day.serviceSum
  into.serviceCount += day.serviceCount
  into.partySum += day.partySum
  into.estimateErrorSum += day.estimateErrorSum
  into.estimateCount += day.estimateCount
  into.estimateHits += day.estimateHits
  addCounts(into.waitHistogram, day.waitHistogram)
  addCounts(into.arrivals, day.arrivals)
  into.lastFinished = Math.max(into.lastFinished, day.lastFinished)
}

const minutes = (seconds: number, count: number) => (count ? Math.round(seconds / count / 60) : null)

/** El minuto en que la cuenta acumulada llega al 90 % de los llamados. */
export function percentileFromHistogram(histogram: Record<string, number>, ratio: number): number | null {
  const buckets = Object.entries(histogram)
    .map(([minute, count]) => [Number(minute), count] as const)
    .sort(([a], [b]) => a - b)
  const total = buckets.reduce((sum, [, count]) => sum + count, 0)
  if (!total) return null
  let seen = 0
  for (const [minute, count] of buckets) {
    seen += count
    if (seen >= ratio * total) return minute
  }
  return buckets.at(-1)![0]
}

function summarize(totals: QueueDay): AnalyticsSummary {
  return {
    visits: totals.visits,
    served: totals.served,
    left: totals.left,
    noShows: totals.noShows,
    averageWaitMinutes: minutes(totals.waitSum, totals.waitCount),
    p90WaitMinutes: percentileFromHistogram(totals.waitHistogram, 0.9),
    averageServiceMinutes: minutes(totals.serviceSum, totals.serviceCount),
    averagePartySize: totals.visits ? Math.round((totals.partySum / totals.visits) * 10) / 10 : null,
    estimateErrorMinutes: minutes(totals.estimateErrorSum, totals.estimateCount),
    estimateHitRate: totals.estimateCount ? totals.estimateHits / totals.estimateCount : null,
    abandonmentRate: totals.visits ? totals.left / totals.visits : 0,
    noShowRate: totals.visits ? totals.noShows / totals.visits : 0,
  }
}

/** El tablero de un rango a partir de sus días. Los días sin visitas aparecen en cero. */
export function figuresFrom(days: readonly DailyAggregate[], from: string, to: string): AnalyticsFigures {
  const inRange = days.filter((day) => day.date >= from && day.date <= to)
  const all = emptyQueueDay('')
  const byQueue = new Map<string, QueueDay>()
  const byDate = new Map<string, QueueDay>()

  for (const day of inRange) {
    const dayTotal = byDate.get(day.date) ?? emptyQueueDay('')
    for (const [queueId, queueDay] of Object.entries(day.queues)) {
      merge(all, queueDay)
      merge(dayTotal, queueDay)
      const queue = byQueue.get(queueId) ?? emptyQueueDay(queueDay.name)
      merge(queue, queueDay)
      byQueue.set(queueId, queue)
    }
    byDate.set(day.date, dayTotal)
  }

  const daily = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const total = byDate.get(date)
    daily.push({
      date,
      visits: total?.visits ?? 0,
      served: total?.served ?? 0,
      averageWaitMinutes: total ? minutes(total.waitSum, total.waitCount) : null,
    })
  }

  const heatmap: AnalyticsHeatCell[] = Object.entries(all.arrivals).map(([code, visits]) => ({
    weekday: Math.floor(Number(code) / 100),
    hour: Number(code) % 100,
    visits,
  }))

  const queues: AnalyticsQueue[] = [...byQueue.entries()]
    .map(([queueId, totals]) => ({ queueId, name: totals.name, ...summarize(totals) }))
    .sort((a, b) => b.visits - a.visits)

  return {
    summary: summarize(all),
    daily,
    heatmap,
    queues,
    dataUntil: all.lastFinished ? new Date(all.lastFinished).toISOString() : null,
  }
}
