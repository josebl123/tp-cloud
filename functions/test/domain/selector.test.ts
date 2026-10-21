import { describe, expect, it } from 'vitest'
import { rotation, select } from '../../src/domain/selector.js'
import { entry, lane } from './fixtures.js'

// Portados de QueueEntrySelectorTest.java.

const small = lane('a-small', { priority: 0, maxPartySize: 2 })
const large = lane('b-large', { priority: 1, minPartySize: 3 })
const lanes = [small, large]

describe('selector', () => {
  it('GLOBAL_AGE ignora los carriles', () => {
    const waiting = [entry('old-large', 1, { laneId: large.id }), entry('new-small', 2, { laneId: small.id })]
    expect(select('GLOBAL_AGE', lanes, rotation(lanes), waiting, 0).entry.id).toBe('old-large')
  })

  it('LANE_PRIORITY elige por prioridad del carril y después por antigüedad', () => {
    const waiting = [
      entry('old-large', 1, { laneId: large.id }),
      entry('small-2', 3, { laneId: small.id }),
      entry('small-1', 2, { laneId: small.id }),
    ]
    expect(select('LANE_PRIORITY', lanes, rotation(lanes), waiting, 0).entry.id).toBe('small-1')
  })

  it('ROUND_ROBIN alterna entre carriles', () => {
    let waiting = [
      entry('s1', 1, { laneId: small.id }),
      entry('s2', 2, { laneId: small.id }),
      entry('l1', 3, { laneId: large.id }),
      entry('l2', 4, { laneId: large.id }),
    ]
    const served: string[] = []
    let cursor = 0
    for (let i = 0; i < 4; i++) {
      const selection = select('ROUND_ROBIN', lanes, rotation(lanes), waiting, cursor)
      served.push(selection.entry.id)
      cursor = selection.nextRoundRobinPosition
      waiting = waiting.filter((candidate) => candidate.id !== selection.entry.id)
    }
    expect(served).toEqual(['s1', 'l1', 's2', 'l2'])
  })

  it('ROUND_ROBIN saltea los carriles vacíos', () => {
    const waiting = [entry('l1', 1, { laneId: large.id })]
    const selection = select('ROUND_ROBIN', lanes, rotation(lanes), waiting, 0)
    expect(selection.entry.id).toBe('l1')
    expect(selection.nextRoundRobinPosition).toBe(0)
  })

  it('un carril que se vacía no corre la rotación', () => {
    const third = lane('c-third', { priority: 2, minPartySize: 10 })
    const all = [small, large, third]
    // A, B y C; se atendió A y B, el cursor dice "C". Que A se vacíe no tiene que cambiar eso.
    const waiting = [entry('b2', 1, { laneId: large.id }), entry('c1', 2, { laneId: third.id })]
    expect(select('ROUND_ROBIN', all, rotation(all), waiting, 2).entry.id).toBe('c1')
  })

  it('es reproducible', () => {
    const waiting = [entry('x', 1, { laneId: small.id }), entry('y', 2, { laneId: large.id })]
    const first = select('ROUND_ROBIN', lanes, rotation(lanes), waiting, 1)
    const second = select('ROUND_ROBIN', lanes, rotation(lanes), waiting, 1)
    expect(second).toEqual(first)
  })

  it('rechaza una fila vacía', () => {
    expect(() => select('GLOBAL_AGE', lanes, rotation(lanes), [], 0)).toThrow(RangeError)
  })

  it('la rotación deja afuera los carriles inactivos y los retirados', () => {
    const inactive = lane('inactive', { active: false })
    const retired = lane('retired', { deletedAt: '2026-01-01T00:00:00.000Z', active: false })
    expect(rotation([large, inactive, small, retired]).map((candidate) => candidate.id)).toEqual(['a-small', 'b-large'])
  })
})
