import { beforeAll, describe, expect, it } from 'vitest'
import type { DailyAggregate } from '../../src/analytics/aggregates.js'
import { AnalyticsStore } from '../../src/persistence/analytics-store.js'
import { createTestTable } from './support.js'

/** Un día por fecha con una sola cola: lo justo para probar el guardado, no la combinación. */
function daysFor(establishmentId: string, dates: string[]): DailyAggregate[] {
  return dates.map((date) => ({
    establishmentId,
    date,
    queues: {
      'demo-barra': {
        name: 'Barra',
        visits: 1,
        served: 1,
        left: 0,
        noShows: 0,
        waitSum: 600,
        waitCount: 1,
        serviceSum: 0,
        serviceCount: 0,
        partySum: 2,
        estimateErrorSum: 0,
        estimateCount: 0,
        estimateHits: 0,
        waitHistogram: { '10': 1 },
        arrivals: { '113': 1 },
        lastFinished: 1772463600000,
      },
    },
  }))
}

let store: AnalyticsStore

beforeAll(async () => {
  store = new AnalyticsStore(await createTestTable(), async () => {})
})

describe('AnalyticsStore contra DynamoDB Local', () => {
  it('guarda más de un lote de días y lee solo los del rango y del local pedidos', async () => {
    // 31 días: más de un BatchWriteItem (25 como máximo).
    const dates = Array.from({ length: 31 }, (_, index) => `2026-01-${String(index + 1).padStart(2, '0')}`)
    await store.putDays([...daysFor('est-a', dates), ...daysFor('est-b', ['2026-01-10'])], new Date())
    const read = await store.days('est-a', '2026-01-05', '2026-01-09')
    expect(read.map((day) => day.date)).toEqual(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'])
    expect(read[0]?.queues['demo-barra']?.waitHistogram).toEqual({ '10': 1 })
  })

  it('recalcular un día lo reemplaza y el tablero sale de lo guardado', async () => {
    const [day] = daysFor('est-c', ['2026-02-01'])
    await store.putDays([day!], new Date())
    await store.putDays([{ ...day!, queues: { 'demo-barra': { ...day!.queues['demo-barra']!, visits: 3, served: 3 } } }], new Date())
    const figures = await store.figures({ establishmentId: 'est-c', from: '2026-02-01', to: '2026-02-01' })
    expect(figures.summary).toMatchObject({ visits: 3, served: 3, averageWaitMinutes: 10, p90WaitMinutes: 10 })
  })
})
