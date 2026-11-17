import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DailyAggregate, QueueDay } from '../../src/analytics/aggregates.js'
import { aggregatesQuery, figuresFrom, parseRows, percentileFromHistogram } from '../../src/analytics/aggregates.js'
import type { VisitFact } from '../../src/analytics/fact.js'
import type { HistoryInput } from '../../src/analytics/history.js'
import { historicalFacts } from '../../src/analytics/history.js'

const HEADER = [
  'establishment_id', 'dt', 'queue_id', 'queue_name', 'visits', 'served', 'left_count', 'no_shows',
  'wait_sum', 'wait_count', 'service_sum', 'service_count', 'party_sum', 'estimate_error_sum',
  'estimate_count', 'estimate_hits', 'wait_histogram', 'arrivals', 'last_finished',
]

/**
 * Lo que devolvería la consulta de Athena, calculado en memoria sobre los mismos hechos: sirve para
 * comprobar que combinar días da lo mismo que calcular el rango entero de una vez.
 */
function athenaRows(facts: readonly VisitFact[]): string[][] {
  const groups = new Map<string, VisitFact[]>()
  for (const fact of facts) {
    const key = `${fact.establishment_id}|${fact.dt}|${fact.queue_id}`
    groups.set(key, [...(groups.get(key) ?? []), fact])
  }
  const rows = [...groups.values()].map((group) => {
    const first = group[0]!
    const called = group.filter((fact) => fact.wait_seconds !== null)
    const estimated = called.filter((fact) => fact.estimated_wait_seconds !== null)
    const errors = estimated.map((fact) => Math.abs(fact.estimated_wait_seconds! - fact.wait_seconds!))
    const histogram = (values: number[]) => {
      const counts: Record<string, number> = {}
      for (const value of values) counts[value] = (counts[value] ?? 0) + 1
      return JSON.stringify(counts)
    }
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
    return [
      first.establishment_id, first.dt, first.queue_id, first.queue_name,
      group.length, group.filter((f) => f.outcome === 'SERVED').length, group.filter((f) => f.outcome === 'LEFT').length,
      group.filter((f) => f.outcome === 'NO_SHOW').length,
      sum(called.map((f) => f.wait_seconds!)), called.length,
      sum(group.filter((f) => f.service_seconds !== null).map((f) => f.service_seconds!)), group.filter((f) => f.service_seconds !== null).length,
      sum(group.map((f) => f.party_size)), sum(errors), errors.length, errors.filter((error) => error <= 300).length,
      histogram(called.map((f) => Math.min(Math.floor(f.wait_seconds! / 60), 240))),
      histogram(group.map((f) => f.local_weekday * 100 + f.local_hour)),
      Math.max(...group.map((f) => f.finished_at)),
    ].map(String)
  })
  return [HEADER, ...rows]
}

const demo = JSON.parse(readFileSync(new URL('../../../terraform/organization/seed/demo.json', import.meta.url), 'utf8')) as Omit<HistoryInput, 'days'>

describe('consulta de Athena', () => {
  it('filtra por la partición y deduplica por visita', () => {
    const sql = aggregatesQuery('q_analitica', 'visitas', '2026-08-01')
    expect(sql).toContain(`FROM "q_analitica"."visitas"`)
    expect(sql).toContain(`WHERE dt >= '2026-08-01'`)
    expect(sql).toContain('PARTITION BY visit_id')
    expect(sql).toContain('GROUP BY establishment_id, dt, queue_id')
  })

  it('no arma SQL con nombres o fechas que no son lo esperado', () => {
    expect(() => aggregatesQuery('q"; DROP', 'visitas', '2026-08-01')).toThrow()
    expect(() => aggregatesQuery('q_analitica', 'visitas', "2026-08-01' OR '1'='1")).toThrow()
  })
})

describe('agregados diarios', () => {
  const facts = historicalFacts({ ...demo, days: 30 }, new Date('2026-03-02T15:00:00.000Z'))
  const days = parseRows(athenaRows(facts))

  it('agrupa las filas de Athena por local y día, con una entrada por cola', () => {
    expect(days.every((day) => day.establishmentId === 'demo-la-parrilla')).toBe(true)
    const someDay = days.find((day) => day.date === '2026-02-20')!
    expect(Object.keys(someDay.queues).sort()).toEqual(['demo-barra', 'demo-mesas'])
    expect(someDay.queues['demo-mesas']!.name).toBe('Mesas')
  })

  it('combinar los días da lo mismo que calcular el rango de una vez', () => {
    const figures = figuresFrom(days, '2026-01-31', '2026-03-02')
    const called = facts.filter((fact) => fact.wait_seconds !== null)
    const waits = called.map((fact) => Math.min(Math.floor(fact.wait_seconds! / 60), 240)).sort((a, b) => a - b)

    expect(figures.summary.visits).toBe(facts.length)
    expect(figures.summary.left).toBe(facts.filter((fact) => fact.outcome === 'LEFT').length)
    expect(figures.summary.averageWaitMinutes).toBe(Math.round(called.reduce((s, f) => s + f.wait_seconds!, 0) / called.length / 60))
    expect(figures.summary.p90WaitMinutes).toBe(waits[Math.ceil(0.9 * waits.length) - 1])
    expect(figures.queues.map((queue) => queue.queueId)).toEqual(['demo-mesas', 'demo-barra'])
    expect(figures.queues.reduce((sum, queue) => sum + queue.visits, 0)).toBe(facts.length)
    expect(figures.heatmap.reduce((sum, cell) => sum + cell.visits, 0)).toBe(facts.length)
    expect(figures.dataUntil).toBe(new Date(Math.max(...facts.map((fact) => fact.finished_at))).toISOString())
  })

  it('devuelve todos los días del rango, también los que no tuvieron visitas, y nada de afuera', () => {
    const figures = figuresFrom(days, '2026-02-25', '2026-03-05')
    expect(figures.daily.map((day) => day.date)).toEqual([
      '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
    ])
    expect(figures.daily.at(-1)).toEqual({ date: '2026-03-05', visits: 0, served: 0, averageWaitMinutes: null })
    expect(figures.summary.visits).toBe(figures.daily.reduce((sum, day) => sum + day.visits, 0))
  })

  it('un rango sin datos no inventa promedios', () => {
    const figures = figuresFrom([], '2026-01-01', '2026-01-03')
    expect(figures.summary).toMatchObject({ visits: 0, averageWaitMinutes: null, p90WaitMinutes: null, abandonmentRate: 0 })
    expect(figures.dataUntil).toBeNull()
  })

  it('usa el nombre más reciente de una cola renombrada', () => {
    const queue = (name: string, lastFinished: number): QueueDay => ({
      ...parseRows(athenaRows(facts.slice(0, 1)))[0]!.queues[facts[0]!.queue_id]!,
      name,
      lastFinished,
    })
    const renamed: DailyAggregate[] = [
      { establishmentId: 'e', date: '2026-02-01', queues: { q: queue('Viejo', 1) } },
      { establishmentId: 'e', date: '2026-02-02', queues: { q: queue('Nuevo', 2) } },
    ]
    expect(figuresFrom(renamed, '2026-02-01', '2026-02-02').queues[0]!.name).toBe('Nuevo')
  })

  it('lee un histograma vacío de Athena como sin datos', () => {
    const [row] = athenaRows(facts.slice(0, 1)).slice(1)
    const empty = [...row!]
    empty[HEADER.indexOf('wait_histogram')] = ''
    expect(parseRows([HEADER, empty])[0]!.queues[facts[0]!.queue_id]!.waitHistogram).toEqual({})
    expect(percentileFromHistogram({}, 0.9)).toBeNull()
    expect(percentileFromHistogram({ 1: 5, 10: 4, 30: 1 }, 0.9)).toBe(10)
  })
})
