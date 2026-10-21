import { describe, expect, it } from 'vitest'
import { averageServiceTime, recordServiceTime, simulateAll, toMinutes } from '../../src/domain/estimation.js'
import { entry, lane, queueState } from './fixtures.js'

// Portados de EstimationServiceTest.java, más la simulación por carriles.

const MINUTE = 60_000

describe('tiempo promedio de servicio', () => {
  it('sin historial usa el valor configurado en la cola', () => {
    const estimate = averageServiceTime(queueState({ defaultServiceMinutes: 5 }).queue)
    expect(estimate).toEqual({ milliseconds: 5 * MINUTE, usingDefault: true, sampleCount: 0 })
  })

  it('con historial promedia los servicios recientes', () => {
    const estimate = averageServiceTime(queueState({ recentServiceSeconds: [240, 480] }).queue)
    expect(estimate).toEqual({ milliseconds: 6 * MINUTE, usingDefault: false, sampleCount: 2 })
  })

  it('ignora las muestras que no se pueden medir', () => {
    expect(averageServiceTime(queueState({ recentServiceSeconds: [0, 600] }).queue).milliseconds).toBe(10 * MINUTE)
  })

  it('conserva solo las últimas diez muestras', () => {
    let recent: number[] = []
    for (let i = 1; i <= 15; i++) recent = recordServiceTime(recent, i * 60)
    expect(recent).toHaveLength(10)
    expect(recent[0]).toBe(6 * 60)
  })
})

describe('simulación de la espera', () => {
  it('la primera persona con un puesto libre no espera', () => {
    const state = queueState()
    const first = entry('first', 1)
    const simulations = simulateAll(state.queue, state.lanes, [first], [], 5 * MINUTE)
    expect(simulations.get('first')?.estimatedWaitMilliseconds).toBe(0)
  })

  it('cuenta a quien está ocupando el puesto', () => {
    const state = queueState()
    const serving = entry('serving', 1, { status: 'SERVING' })
    const waiting = ['a', 'b', 'c'].map((id, index) => entry(id, index + 2))
    const simulations = simulateAll(state.queue, state.lanes, waiting, [serving], 5 * MINUTE)
    expect(simulations.get('a')?.estimatedWaitMilliseconds).toBe(5 * MINUTE)
    expect(simulations.get('c')?.estimatedWaitMilliseconds).toBe(15 * MINUTE)
  })

  it('los puestos en paralelo dividen la espera', () => {
    const state = queueState({ serviceStations: 3 })
    const serving = entry('serving', 1, { status: 'SERVING' })
    const waiting = Array.from({ length: 7 }, (_, index) => entry(`w${index}`, index + 2))
    const simulations = simulateAll(state.queue, state.lanes, waiting, [serving], 5 * MINUTE)
    // 6 adelante + 1 atendiéndose = 7 sobre 3 puestos: arranca en la tercera ronda.
    expect(simulations.get('w6')?.estimatedWaitMilliseconds).toBe(10 * MINUTE)
    expect(simulations.get('w1')?.estimatedWaitMilliseconds).toBe(0)
  })

  it('el factor de tiempo del carril alarga los servicios de ese carril', () => {
    const state = queueState()
    const slow = lane('slow', { timeFactor: 2 })
    state.lanes.push(slow)
    const waiting = [entry('big', 1, { laneId: 'slow' }), entry('next', 2)]
    const simulations = simulateAll(state.queue, state.lanes, waiting, [], 5 * MINUTE)
    expect(simulations.get('next')?.estimatedWaitMilliseconds).toBe(10 * MINUTE)
  })

  it('el lugar en el carril sigue la clave de orden y no la estrategia', () => {
    const state = queueState({ callStrategy: 'LANE_PRIORITY' })
    const vip = lane('vip', { priority: 0, minPartySize: 5 })
    state.lanes[0] = { ...state.lanes[0]!, priority: 1 }
    state.lanes.push(vip)
    const waiting = [entry('regular', 1), entry('vip-guest', 2, { laneId: 'vip', partySize: 6 })]
    const simulations = simulateAll(state.queue, state.lanes, waiting, [], 5 * MINUTE)
    expect(simulations.get('vip-guest')).toMatchObject({ lanePosition: 1, globalWaitingGroupsAhead: 0 })
    expect(simulations.get('regular')).toMatchObject({ lanePosition: 1, globalWaitingGroupsAhead: 1 })
  })

  it('los minutos se redondean para arriba', () => {
    expect(toMinutes(61_000)).toBe(2)
    expect(toMinutes(60_000)).toBe(1)
    expect(toMinutes(0)).toBe(0)
    expect(toMinutes(null)).toBe(0)
  })
})
