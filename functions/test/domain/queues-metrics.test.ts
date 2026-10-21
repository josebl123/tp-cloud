import { describe, expect, it } from 'vitest'
import { DomainError } from '../../src/domain/errors.js'
import { computeMetrics, windowFor } from '../../src/domain/metrics.js'
import { dueForEvent, dueThresholds } from '../../src/domain/notifications.js'
import { simulateAll } from '../../src/domain/estimation.js'
import { createLane, retireLane, updateLane, updateQueue } from '../../src/domain/queues.js'
import { staff } from '../../src/domain/state.js'
import { NOW, entry, queueState, session } from './fixtures.js'

const STAFF = staff('owner')
const codeOf = (action: () => unknown) => {
  try {
    action()
  } catch (error) {
    return error instanceof DomainError ? error.code : 'otro'
  }
  return undefined
}

describe('configuración de la cola', () => {
  it('valida igual que los CHECK de la base', () => {
    const s = session(queueState())
    expect(codeOf(() => updateQueue(s, { serviceStations: 0 }, STAFF))).toBe('INVALID_SERVICE_STATIONS')
    expect(codeOf(() => updateQueue(s, { gracePeriodSeconds: -1 }, STAFF))).toBe('INVALID_GRACE_PERIOD')
    expect(codeOf(() => updateQueue(s, { notifyAtMinutes: 0 }, STAFF))).toBe('INVALID_NOTIFY_MINUTES')
  })

  it('cada valor tiene techo y tiene que ser entero', () => {
    const s = session(queueState())
    expect(codeOf(() => updateQueue(s, { gracePeriodSeconds: 1_000_000_000 }, STAFF))).toBe('INVALID_GRACE_PERIOD')
    expect(codeOf(() => updateQueue(s, { serviceStations: 1.5 }, STAFF))).toBe('INVALID_SERVICE_STATIONS')
    expect(codeOf(() => updateQueue(s, { maxSize: 5000 }, STAFF))).toBe('INVALID_MAX_SIZE')
    expect(codeOf(() => updateQueue(s, { name: 'x'.repeat(121) }, STAFF))).toBe('QUEUE_NAME_TOO_LONG')
    // Ninguno de los intentos fallidos dejó la cola cambiada.
    expect(s.queue.gracePeriodSeconds).toBe(120)
    expect(s.events).toHaveLength(0)
  })
})

describe('carriles', () => {
  it('admite rangos anidados y rechaza los que se cruzan', () => {
    const s = session(queueState())
    createLane(s, 'parejas', { name: 'Parejas', minPartySize: 1, maxPartySize: 2, priority: 0 }, STAFF)
    expect(
      codeOf(() => createLane(s, 'cruce', { name: 'Cruce', minPartySize: 2, maxPartySize: 4, priority: 1 }, STAFF)),
    ).toBe('CROSSING_LANE_RANGES')
  })

  it('no permite nombres repetidos ni quedarse sin carril activo', () => {
    const s = session(queueState())
    expect(codeOf(() => createLane(s, 'otro', { name: '1+', minPartySize: 1, priority: 0 }, STAFF))).toBe('LANE_NAME_TAKEN')
    expect(codeOf(() => retireLane(s, 'lane-default', STAFF))).toBe('LAST_ACTIVE_LANE')
    expect(codeOf(() => updateLane(s, 'lane-default', { name: '1+', minPartySize: 1, priority: 0, active: false }, STAFF)))
      .toBe('LAST_ACTIVE_LANE')
  })

  it('no se desactiva un carril con gente: en round robin quedaría sin atender', () => {
    const state = queueState({ callStrategy: 'ROUND_ROBIN' })
    const s = session(state)
    createLane(s, 'grupos', { name: 'Grupos', minPartySize: 5, priority: 1 }, STAFF)
    state.entries.push(entry('grupo', 1, { laneId: 'grupos', partySize: 6 }))
    expect(
      codeOf(() => updateLane(s, 'grupos', { name: 'Grupos', minPartySize: 5, priority: 1, active: false }, STAFF)),
    ).toBe('LANE_HAS_ACTIVE_ENTRIES')
    expect(codeOf(() => retireLane(s, 'grupos', STAFF))).toBe('LANE_HAS_ACTIVE_ENTRIES')
  })

  it('un carril con valores fuera de rango se rechaza', () => {
    const s = session(queueState())
    expect(codeOf(() => createLane(s, 'raro', { name: 'Raro', minPartySize: 5, priority: 1, timeFactor: 0 }, STAFF))).toBe(
      'INVALID_LANE_CONFIGURATION',
    )
    expect(codeOf(() => createLane(s, 'raro', { name: 'Raro', minPartySize: 1.5, priority: 1 }, STAFF))).toBe(
      'INVALID_LANE_RANGE',
    )
  })

  it('retirar no borra: el carril queda con fecha de baja', () => {
    const s = session(queueState())
    createLane(s, 'grupos', { name: 'Grupos', minPartySize: 5, priority: 1 }, STAFF)
    const retired = retireLane(s, 'grupos', STAFF)
    expect(retired.deletedAt).toBe(NOW.toISOString())
    expect(retired.active).toBe(false)
    expect(s.state.lanes).toHaveLength(2)
  })
})

describe('métricas', () => {
  it('la ventana de hoy empieza a la medianoche local, no a la de UTC', () => {
    // 15:00 UTC son las 12:00 en Buenos Aires (UTC-3).
    expect(windowFor('America/Argentina/Buenos_Aires', 1, NOW)).toEqual({
      from: '2026-03-02T03:00:00.000Z',
      to: '2026-03-03T03:00:00.000Z',
    })
    expect(windowFor('America/Argentina/Buenos_Aires', 7, NOW).from).toBe('2026-02-24T03:00:00.000Z')
  })

  it('una zona horaria inválida cae en la de Buenos Aires', () => {
    expect(windowFor('No/Existe', 1, NOW).from).toBe('2026-03-02T03:00:00.000Z')
  })

  it('cuenta, promedia y calcula proporciones como la versión Java', () => {
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()
    const finished = [
      entry('s1', 1, { status: 'SERVED', joinedAt: at(0), calledAt: at(10), servingStartedAt: at(10), finishedAt: at(14) }),
      entry('s2', 2, { status: 'SERVED', joinedAt: at(0), calledAt: at(20), servingStartedAt: at(20), finishedAt: at(26) }),
      entry('l1', 3, { status: 'LEFT', finishedAt: at(5) }),
      entry('n1', 4, { status: 'NO_SHOW', finishedAt: at(5) }),
    ]
    const metrics = computeMetrics(finished, [entry('w', 5), entry('c', 6, { status: 'CALLED' })])
    expect(metrics).toEqual({
      waitingNow: 1,
      inServiceNow: 1,
      servedCount: 2,
      noShowCount: 1,
      leftCount: 1,
      finishedCount: 4,
      averageWaitMinutes: 15,
      averageServiceMinutes: 5,
      abandonmentRate: 0.25,
      noShowRate: 0.25,
    })
  })
})

describe('avisos debidos', () => {
  it('avisa a quienes cruzaron el umbral de posición o de minutos', () => {
    const state = queueState({ notifyAtPosition: 1, notifyAtMinutes: 6, defaultServiceMinutes: 5 })
    const waiting = [entry('a', 1), entry('b', 2), entry('c', 3)]
    const due = dueThresholds(state.queue, waiting, simulateAll(state.queue, state.lanes, waiting, [], 5 * 60_000))
    expect(due.map((notice) => `${notice.entry.id}:${notice.type}`)).toEqual([
      'a:APPROACHING_POSITION',
      'a:APPROACHING_TIME',
      'b:APPROACHING_POSITION',
      'b:APPROACHING_TIME',
    ])
  })

  it('sin umbrales configurados no avisa nada', () => {
    const state = queueState()
    const waiting = [entry('a', 1)]
    expect(dueThresholds(state.queue, waiting, simulateAll(state.queue, state.lanes, waiting, [], 1))).toEqual([])
  })

  it('cada evento dispara su aviso, con el ciclo del momento', () => {
    const ana = entry('ana', 1, { notificationCycle: 2 })
    const event = (type: 'ENTRY_CALLED' | 'ENTRY_LEFT' | 'ENTRY_SERVED', detail = {}) => ({
      id: 'e',
      queueId: 'queue-1',
      entryId: 'ana',
      type,
      actorType: 'STAFF' as const,
      actorId: null,
      cycle: 1,
      detail,
      occurredAt: NOW.toISOString(),
    })
    expect(dueForEvent(event('ENTRY_CALLED'), ana, undefined)).toMatchObject({ type: 'YOUR_TURN', cycle: 1 })
    expect(dueForEvent(event('ENTRY_LEFT', { reason: 'QUEUE_CLOSED' }), ana, undefined)?.type).toBe('QUEUE_CLOSED')
    expect(dueForEvent(event('ENTRY_LEFT'), ana, undefined)).toBeNull()
    expect(dueForEvent(event('ENTRY_SERVED'), ana, undefined)).toBeNull()
  })
})
