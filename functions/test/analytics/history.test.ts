import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { addDays, analyticsWindow, parseAnalyticsRange } from '../../src/analytics/dashboard.js'
import type { HistoryInput } from '../../src/analytics/history.js'
import { historicalFacts } from '../../src/analytics/history.js'

const NOW = new Date('2026-03-02T15:00:00.000Z')
const demo = JSON.parse(readFileSync(new URL('../../../terraform/organization/seed/demo.json', import.meta.url), 'utf8')) as Omit<HistoryInput, 'days'>
const input: HistoryInput = { ...demo, days: 30 }

describe('ventana del tablero', () => {
  it('termina hoy en la zona del local e incluye los dos extremos', () => {
    // 01:00 UTC del 3 de marzo todavía es 2 de marzo en Buenos Aires.
    expect(analyticsWindow('LAST_30_DAYS', 'America/Argentina/Buenos_Aires', new Date('2026-03-03T01:00:00.000Z'))).toEqual({
      from: '2026-02-01',
      to: '2026-03-02',
    })
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('acepta solo los rangos conocidos', () => {
    expect(parseAnalyticsRange(undefined)).toBe('LAST_30_DAYS')
    expect(parseAnalyticsRange('LAST_90_DAYS')).toBe('LAST_90_DAYS')
    expect(() => parseAnalyticsRange('ALL')).toThrow()
  })
})

describe('historial de demo', () => {
  const facts = historicalFacts(input, NOW)

  it('es determinista, con ids únicos', () => {
    expect(historicalFacts(input, NOW)).toEqual(facts)
    expect(new Set(facts.map((fact) => fact.visit_id)).size).toBe(facts.length)
  })

  it('cubre los días pedidos, terminando ayer, y todas las colas', () => {
    const days = [...new Set(facts.map((fact) => fact.local_date))].sort()
    expect(days[0]).toBe('2026-01-31')
    expect(days.at(-1)).toBe('2026-03-01')
    expect(new Set(facts.map((fact) => fact.queue_id))).toEqual(new Set(['demo-mesas', 'demo-barra']))
  })

  it('tiene picos de almuerzo y cena, y más gente el fin de semana', () => {
    const at = (hour: number) => facts.filter((fact) => fact.local_hour === hour).length
    expect(at(13)).toBeGreaterThan(at(15) * 2)
    expect(at(21)).toBeGreaterThan(at(19) * 3)
    expect(facts.some((fact) => fact.local_hour >= 16 && fact.local_hour <= 18)).toBe(false)
    const perDay = (weekday: number) => facts.filter((fact) => fact.local_weekday === weekday).length
    expect(perDay(6)).toBeGreaterThan(perDay(1) * 1.5)
  })

  it('reparte los grupos en el carril que les corresponde y mezcla los tres finales', () => {
    const big = facts.filter((fact) => fact.queue_id === 'demo-mesas' && fact.party_size >= 3)
    expect(big.every((fact) => fact.lane_id === 'demo-mesas-grandes')).toBe(true)
    const outcomes = new Set(facts.map((fact) => fact.outcome))
    expect(outcomes).toEqual(new Set(['SERVED', 'LEFT', 'NO_SHOW']))
    expect(facts.every((fact) => fact.estimated_wait_seconds !== null)).toBe(true)
  })
})
