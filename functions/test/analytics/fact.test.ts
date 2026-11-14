import { describe, expect, it } from 'vitest'
import type { VisitContext } from '../../src/analytics/fact.js'
import { localParts, visitFact } from '../../src/analytics/fact.js'
import { entry } from '../domain/fixtures.js'

const CONTEXT: VisitContext = {
  establishment: { id: 'est-1', name: 'Café Central', timezone: 'America/Argentina/Buenos_Aires' },
  queue: { id: 'queue-1', name: 'Mesas', noShowPolicy: 'REMOVE' },
  lane: { id: 'lane-default', name: 'General' },
}

describe('localParts', () => {
  it('usa la zona horaria del local, no la de UTC', () => {
    // 02:30 UTC del martes es 23:30 del lunes en Buenos Aires.
    expect(localParts('2026-03-03T02:30:00.000Z', 'America/Argentina/Buenos_Aires')).toEqual({
      date: '2026-03-02',
      hour: 23,
      weekday: 1,
    })
    expect(localParts('2026-03-08T12:00:00.000Z', 'UTC')).toEqual({ date: '2026-03-08', hour: 12, weekday: 7 })
  })
})

describe('visitFact', () => {
  it('no registra una visita que sigue en la fila', () => {
    expect(visitFact(entry('e1', 1), CONTEXT)).toBeNull()
    expect(visitFact(entry('e1', 1, { status: 'CALLED', calledAt: '2026-03-02T15:00:00.000Z' }), CONTEXT)).toBeNull()
  })

  it('calcula la espera, el servicio y la estimación de un atendido', () => {
    const fact = visitFact(
      entry('e1', 1, {
        status: 'SERVED',
        partySize: 3,
        joinedAt: '2026-03-02T15:00:00.000Z',
        calledAt: '2026-03-02T15:12:00.000Z',
        servingStartedAt: '2026-03-02T15:14:00.000Z',
        finishedAt: '2026-03-02T15:44:30.000Z',
        joinEstimateSeconds: 600,
      }),
      CONTEXT,
    )
    expect(fact).toMatchObject({
      visit_id: 'e1',
      establishment_name: 'Café Central',
      queue_name: 'Mesas',
      lane_name: 'General',
      party_size: 3,
      outcome: 'SERVED',
      joined_at: Date.parse('2026-03-02T15:00:00.000Z'),
      wait_seconds: 720,
      service_seconds: 1830,
      time_in_line_seconds: 2670,
      estimated_wait_seconds: 600,
      local_date: '2026-03-02',
      local_hour: 12,
      local_weekday: 1,
      dt: '2026-03-02',
    })
  })

  it('deja sin espera ni servicio a quien se fue antes de que lo llamaran', () => {
    const fact = visitFact(
      entry('e1', 1, { status: 'LEFT', joinedAt: '2026-03-02T15:00:00.000Z', finishedAt: '2026-03-02T15:05:00.000Z' }),
      CONTEXT,
    )
    expect(fact).toMatchObject({ outcome: 'LEFT', called_at: null, wait_seconds: null, service_seconds: null, time_in_line_seconds: 300 })
    // Una entrada anterior a la analítica no trae estimación.
    expect(fact?.estimated_wait_seconds).toBeNull()
  })

  it('particiona por el día local en que terminó, aunque haya llegado el día anterior', () => {
    const fact = visitFact(
      entry('e1', 1, {
        status: 'NO_SHOW',
        noShowCount: 1,
        joinedAt: '2026-03-03T02:50:00.000Z',
        calledAt: '2026-03-03T02:58:00.000Z',
        finishedAt: '2026-03-03T03:05:00.000Z',
      }),
      CONTEXT,
    )
    expect(fact).toMatchObject({ local_date: '2026-03-02', local_hour: 23, dt: '2026-03-03', no_show_count: 1, service_seconds: null })
  })
})
