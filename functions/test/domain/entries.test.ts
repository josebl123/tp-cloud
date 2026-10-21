import { describe, expect, it } from 'vitest'
import {
  call,
  callNext,
  cancel,
  join,
  leave,
  markNoShow,
  markServed,
  releaseBatch,
  requeue,
  startServing,
  transition,
} from '../../src/domain/entries.js'
import { LIMITS } from '../../src/domain/entries.js'
import { DomainError } from '../../src/domain/errors.js'
import { expireDue } from '../../src/domain/grace.js'
import { changeStatus } from '../../src/domain/queues.js'
import { CUSTOMER, staff } from '../../src/domain/state.js'
import type { NoShowPolicy } from '../../src/domain/types.js'
import { NOW, entry, ids, lane, queueState, session } from './fixtures.js'

const STAFF = staff('user-1')
const IN_A_MINUTE = new Date(NOW.getTime() + 60_000).toISOString()

const codeOf = (action: () => unknown): string | undefined => {
  try {
    action()
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
  return undefined
}

describe('join', () => {
  it('reparte números de ticket correlativos y pone a cada uno al final', () => {
    const s = session(queueState())
    const ana = join(s, { name: ' Ana ', email: 'ANA@example.com' })
    const bruno = join(s, { name: 'Bruno', phone: '+54 11 5555 5555' })
    expect([ana.ticketNumber, bruno.ticketNumber]).toEqual([1, 2])
    expect(ids(s.waiting())).toEqual([ana.id, bruno.id])
    expect(ana.customerName).toBe('Ana')
    expect(ana.customerEmail).toBe('ana@example.com')
    expect(s.events.map((event) => event.type)).toEqual(['ENTRY_JOINED', 'ENTRY_JOINED'])
  })

  it('exige nombre y algún canal de contacto', () => {
    const s = session(queueState())
    expect(codeOf(() => join(s, { name: '  ', email: 'a@b.c' }))).toBe('CUSTOMER_NAME_REQUIRED')
    expect(codeOf(() => join(s, { name: 'Ana' }))).toBe('CONTACT_REQUIRED')
  })

  it('no acepta gente en una cola pausada o cerrada', () => {
    expect(codeOf(() => join(session(queueState({ status: 'PAUSED' })), { name: 'A', email: 'a@b.c' }))).toBe(
      'QUEUE_NOT_ACCEPTING',
    )
    expect(codeOf(() => join(session(queueState({ status: 'CLOSED' })), { name: 'A', email: 'a@b.c' }))).toBe(
      'QUEUE_NOT_ACCEPTING',
    )
  })

  it('respeta el tamaño máximo de la cola', () => {
    const state = queueState({ maxSize: 2 })
    state.entries.push(entry('a', 1), entry('b', 2, { status: 'CALLED' }))
    expect(codeOf(() => join(session(state), { name: 'C', email: 'c@x.y' }))).toBe('QUEUE_FULL')
  })

  it('pone techo a lo que escribe un cliente anónimo', () => {
    const s = session(queueState())
    expect(codeOf(() => join(s, { name: 'x'.repeat(121), email: 'a@b.co' }))).toBe('CUSTOMER_NAME_TOO_LONG')
    expect(codeOf(() => join(s, { name: 'Ana', email: 'no-es-un-mail' }))).toBe('INVALID_EMAIL')
    expect(codeOf(() => join(s, { name: 'Ana', email: `${'a'.repeat(250)}@b.co` }))).toBe('INVALID_EMAIL')
    expect(codeOf(() => join(s, { name: 'Ana', phone: '<script>' }))).toBe('INVALID_PHONE')
    expect(codeOf(() => join(s, { name: 'Ana', email: 'a@b.co', partySize: 51 }))).toBe('INVALID_PARTY_SIZE')
    expect(codeOf(() => join(s, { name: 'Ana', email: 'a@b.co', partySize: 2.5 }))).toBe('INVALID_PARTY_SIZE')
    expect(s.events).toHaveLength(0)
  })

  it('un idioma desconocido cae en inglés', () => {
    const s = session(queueState())
    expect(join(s, { name: 'Ana', email: 'a@b.co', locale: 'xx' as 'en' }).locale).toBe('en')
    expect(join(s, { name: 'Bea', email: 'b@b.co', locale: 'es' }).locale).toBe('es')
  })

  it('sin maxSize igual hay un techo absoluto de entradas activas', () => {
    const state = queueState({ maxSize: null })
    for (let i = 1; i <= LIMITS.activeEntries; i++) state.entries.push(entry(`e${i}`, i))
    expect(codeOf(() => join(session(state), { name: 'Una más', email: 'x@y.zz' }))).toBe('QUEUE_FULL')
  })

  it('elige el carril más específico y respeta su capacidad', () => {
    const state = queueState()
    state.lanes.push(lane('big', { minPartySize: 5, maxSize: 6, capacityMode: 'PERSONS' }))
    state.entries.push(entry('party', 1, { laneId: 'big', partySize: 4 }))
    const s = session(state)
    expect(join(s, { name: 'Dos', email: 'd@x.y', partySize: 2 }).laneId).toBe('lane-default')
    expect(codeOf(() => join(s, { name: 'Cinco', email: 'c@x.y', partySize: 5 }))).toBe('LANE_FULL')
  })
})

describe('llamar', () => {
  it('llama al que más espera y le fija el vencimiento de la gracia', () => {
    const state = queueState({ gracePeriodSeconds: 120 })
    state.entries.push(entry('a', 1), entry('b', 2))
    const s = session(state)
    const called = callNext(s, STAFF)
    expect(called.id).toBe('a')
    expect(called.status).toBe('CALLED')
    expect(called.graceExpiresAt).toBe(new Date(NOW.getTime() + 120_000).toISOString())
    expect(s.events[0]).toMatchObject({ type: 'ENTRY_CALLED', entryId: 'a', actorType: 'STAFF', actorId: 'user-1' })
  })

  it('una gracia de cero no vence nunca', () => {
    const state = queueState({ gracePeriodSeconds: 0 })
    state.entries.push(entry('a', 1))
    expect(callNext(session(state), STAFF).graceExpiresAt).toBeNull()
  })

  it('con la fila vacía responde QUEUE_EMPTY', () => {
    expect(codeOf(() => callNext(session(queueState()), STAFF))).toBe('QUEUE_EMPTY')
  })

  it('una cola cerrada no se opera', () => {
    const state = queueState({ status: 'CLOSED' })
    state.entries.push(entry('a', 1))
    expect(codeOf(() => callNext(session(state), STAFF))).toBe('QUEUE_CLOSED')
  })

  it('el round robin guarda el cursor en la cola', () => {
    const state = queueState({ callStrategy: 'ROUND_ROBIN' })
    state.lanes.push(lane('z-second', { priority: 1, minPartySize: 5 }))
    state.entries.push(entry('a', 1), entry('b', 2), entry('big', 3, { laneId: 'z-second', partySize: 6 }))
    const s = session(state)
    expect(callNext(s, STAFF).id).toBe('a')
    expect(s.queue.roundRobinPosition).toBe(1)
    expect(callNext(s, STAFF).id).toBe('big')
  })

  it('las transiciones inválidas se rechazan', () => {
    const state = queueState()
    state.entries.push(entry('a', 1))
    const s = session(state)
    expect(codeOf(() => startServing(s, 'a', STAFF))).toBe('INVALID_TRANSITION')
    expect(codeOf(() => transition(s, 'nadie', 'CALLED', STAFF))).toBe('ENTRY_NOT_FOUND')
  })
})

describe('atender', () => {
  it('marcar atendido guarda la duración para las esperas futuras', () => {
    const state = queueState()
    const startedAt = new Date(NOW.getTime() - 4 * 60_000).toISOString()
    state.entries.push(entry('a', 1, { status: 'SERVING', calledAt: startedAt, servingStartedAt: startedAt }))
    const s = session(state)
    const served = markServed(s, 'a', STAFF)
    expect(served.status).toBe('SERVED')
    expect(served.finishedAt).toBe(NOW.toISOString())
    expect(s.queue.recentServiceSeconds).toEqual([240])
  })

  it('pasar directo de llamado a atendido cuenta desde el llamado', () => {
    const state = queueState()
    const calledAt = new Date(NOW.getTime() - 60_000).toISOString()
    state.entries.push(entry('a', 1, { status: 'CALLED', calledAt }))
    const s = session(state)
    markServed(s, 'a', STAFF)
    expect(s.queue.recentServiceSeconds).toEqual([60])
  })
})

describe('ausencias', () => {
  const calledState = (policy: NoShowPolicy, moveBack = 2) => {
    const state = queueState({ noShowPolicy: policy, moveBackPositions: moveBack })
    state.entries.push(
      entry('ana', 1, { status: 'CALLED', calledAt: NOW.toISOString(), graceExpiresAt: IN_A_MINUTE }),
      entry('bruno', 2),
      entry('carla', 3),
      entry('dario', 4),
    )
    return state
  }

  it('KEEP_POSITION la devuelve a su lugar', () => {
    const s = session(calledState('KEEP_POSITION'))
    markNoShow(s, 'ana', STAFF)
    expect(ids(s.waiting())).toEqual(['ana', 'bruno', 'carla', 'dario'])
  })

  it('MOVE_BACK la corre N lugares, como el ejemplo de architecture.md', () => {
    const s = session(calledState('MOVE_BACK', 2))
    markNoShow(s, 'ana', STAFF)
    expect(ids(s.waiting())).toEqual(['bruno', 'carla', 'ana', 'dario'])
    expect(s.events.at(-1)?.detail).toMatchObject({ policy: 'MOVE_BACK', newPosition: 3 })
  })

  it('MOVE_TO_END la manda al final', () => {
    const s = session(calledState('MOVE_TO_END'))
    markNoShow(s, 'ana', STAFF)
    expect(ids(s.waiting())).toEqual(['bruno', 'carla', 'dario', 'ana'])
  })

  it('REMOVE la saca de la fila', () => {
    const s = session(calledState('REMOVE'))
    const ana = markNoShow(s, 'ana', STAFF)
    expect(ana.status).toBe('NO_SHOW')
    expect(ana.finishedAt).toBe(NOW.toISOString())
    expect(ids(s.waiting())).toEqual(['bruno', 'carla', 'dario'])
  })

  it('dos MOVE_BACK al mismo lugar no repiten clave aunque el primero esté llamado', () => {
    // Bruno cae entre Dario y Eva, y después lo llaman: mientras no está en la fila conserva su
    // clave, porque si vuelve con "deshacer llamado" la reclama. Cuando Ana cae en el mismo lugar, el
    // punto medio de esos vecinos es justo la clave de Bruno. Si se la dieran, al deshacer el llamado
    // de Bruno las dos entradas tendrían el mismo SK y DynamoDB pisaría a una con la otra.
    const state = queueState({ noShowPolicy: 'MOVE_BACK', moveBackPositions: 2 })
    state.entries.push(
      entry('ana', 1, { status: 'CALLED', graceExpiresAt: IN_A_MINUTE }),
      entry('bruno', 2, { status: 'CALLED', graceExpiresAt: IN_A_MINUTE }),
      entry('carla', 3),
      entry('dario', 4),
      entry('eva', 5),
    )
    const s = session(state)
    markNoShow(s, 'bruno', STAFF)
    expect(ids(s.waiting())).toEqual(['carla', 'dario', 'bruno', 'eva'])
    const brunoKey = s.findEntry('bruno')?.orderKey

    call(s, 'bruno', STAFF)
    markNoShow(s, 'ana', STAFF)
    expect(ids(s.waiting())).toEqual(['carla', 'dario', 'ana', 'eva'])
    expect(s.findEntry('ana')?.orderKey).not.toBe(brunoKey)

    requeue(s, 'bruno', STAFF)
    const keys = s.waiting().map((candidate) => candidate.orderKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(ids(s.waiting())).toEqual(['carla', 'dario', 'ana', 'bruno', 'eva'])
  })

  it('volver a esperar abre un ciclo de avisos nuevo', () => {
    const s = session(calledState('MOVE_TO_END'))
    const ana = markNoShow(s, 'ana', STAFF)
    expect(ana.notificationCycle).toBe(1)
    expect(ana.noShowCount).toBe(1)
  })

  it('cualquier operación vence primero las gracias pasadas', () => {
    const s = session(calledState('MOVE_TO_END'), new Date(NOW.getTime() + 120_000))
    // La gracia de Ana ya pasó: llamar al siguiente tiene que verla de vuelta en la fila, al final.
    expect(callNext(s, STAFF).id).toBe('bruno')
    expect(s.events.map((event) => event.type)).toEqual(['ENTRY_NO_SHOW', 'ENTRY_CALLED'])
  })

  it('una gracia que no venció no se toca', () => {
    const state = queueState()
    state.entries.push(entry('a', 1, { status: 'CALLED', graceExpiresAt: new Date(NOW.getTime() + 1000).toISOString() }))
    expect(expireDue(session(state))).toBe(false)
  })
})

describe('salir y volver', () => {
  it('el cliente puede irse, pero no dos veces', () => {
    const state = queueState()
    state.entries.push(entry('a', 1))
    const s = session(state)
    expect(leave(s, 'a').status).toBe('LEFT')
    expect(codeOf(() => leave(s, 'a'))).toBe('ENTRY_NOT_ACTIVE')
    expect(s.events[0]).toMatchObject({ type: 'ENTRY_LEFT', actorType: CUSTOMER.type })
  })

  it('deshacer un llamado conserva el lugar; traer de vuelta a alguien que se fue lo pone al final', () => {
    const state = queueState()
    state.entries.push(entry('a', 1, { status: 'CALLED' }), entry('b', 2), entry('c', 3))
    const s = session(state)
    requeue(s, 'a', STAFF)
    expect(ids(s.waiting())).toEqual(['a', 'b', 'c'])
    cancel(s, 'a', STAFF)
    requeue(s, 'a', STAFF)
    expect(ids(s.waiting())).toEqual(['b', 'c', 'a'])
    expect(codeOf(() => requeue(s, 'a', STAFF))).toBe('ALREADY_WAITING')
  })
})

// Traer de vuelta a alguien que ya había terminado es un ingreso nuevo: pasa por los mismos tres
// controles que `join`, en el mismo orden. Su carril pudo haberse apagado o retirado mientras estaba
// afuera (la regla que impide apagar un carril solo mira a los activos), y sin esto volvía a esperar
// en un carril que el round robin no visita, o que el tablero ni siquiera muestra.
describe('traer de vuelta a alguien que ya había terminado', () => {
  const FINISHED = { status: 'LEFT' as const, finishedAt: NOW.toISOString() }
  const small = (overrides = {}) => lane('small', { minPartySize: 1, maxPartySize: 4, ...overrides })

  it('si su carril se apagó, va al que hoy acepte su tamaño, al final de la fila', () => {
    const state = queueState()
    state.lanes = [small(), lane('big', { minPartySize: 5, active: false }), lane('big2', { minPartySize: 5 })]
    state.entries.push(
      entry('a', 1, { laneId: 'small' }),
      entry('gone', 2, { laneId: 'big', partySize: 6, ...FINISHED }),
    )
    const s = session(state)
    const back = requeue(s, 'gone', STAFF)
    expect(back.laneId).toBe('big2')
    expect(ids(s.waiting())).toEqual(['a', 'gone'])
    expect(s.events.at(-1)).toMatchObject({
      type: 'ENTRY_REQUEUED',
      detail: { placement: 'END', laneId: 'big2', previousLaneId: 'big' },
    })
  })

  it('si su carril se retiró, también', () => {
    const state = queueState()
    state.lanes = [lane('big', { minPartySize: 5, active: false, deletedAt: NOW.toISOString() }), lane('big2', { minPartySize: 5 })]
    state.entries.push(entry('gone', 1, { laneId: 'big', partySize: 6, ...FINISHED }))
    expect(requeue(session(state), 'gone', STAFF).laneId).toBe('big2')
  })

  it('si su carril sigue abierto pero ya no acepta su tamaño, también se lo reubica', () => {
    const state = queueState()
    // Era "5+" y se editó a "6+": un grupo de 5 ya no le corresponde.
    state.lanes = [lane('big', { minPartySize: 6 }), lane('five', { minPartySize: 5, maxPartySize: 5 })]
    state.entries.push(entry('gone', 1, { laneId: 'big', partySize: 5, ...FINISHED }))
    expect(requeue(session(state), 'gone', STAFF).laneId).toBe('five')
  })

  it('si su carril sigue abierto y tiene lugar, se queda en el suyo', () => {
    const state = queueState()
    state.lanes = [small(), lane('all', { minPartySize: 1 })]
    state.entries.push(entry('gone', 1, { laneId: 'small', partySize: 2, ...FINISHED }))
    const s = session(state)
    expect(requeue(s, 'gone', STAFF).laneId).toBe('small')
    expect(s.events.at(-1)?.detail).toEqual({ placement: 'END' })
  })

  it('si ningún carril acepta su tamaño, se rechaza y no cambia nada', () => {
    const state = queueState()
    state.lanes = [small(), lane('big', { minPartySize: 5, active: false })]
    state.entries.push(entry('gone', 1, { laneId: 'big', partySize: 6, ...FINISHED }))
    const s = session(state)
    expect(codeOf(() => requeue(s, 'gone', STAFF))).toBe('NO_COMPATIBLE_LANE')
    expect(s.findEntry('gone')).toMatchObject({ status: 'LEFT', laneId: 'big' })
    expect(s.events).toEqual([])
  })

  it('respeta el tope de su propio carril aunque siga abierto', () => {
    const state = queueState()
    state.lanes = [small({ maxSize: 1 })]
    state.entries.push(entry('a', 1, { laneId: 'small' }), entry('gone', 2, { laneId: 'small', ...FINISHED }))
    expect(codeOf(() => requeue(session(state), 'gone', STAFF))).toBe('LANE_FULL')
  })

  it('respeta el tope del carril al que se lo mueve', () => {
    const state = queueState()
    state.lanes = [lane('big', { minPartySize: 5, active: false }), lane('big2', { minPartySize: 5, maxSize: 1 })]
    state.entries.push(
      entry('b', 1, { laneId: 'big2', partySize: 5 }),
      entry('gone', 2, { laneId: 'big', partySize: 6, ...FINISHED }),
    )
    expect(codeOf(() => requeue(session(state), 'gone', STAFF))).toBe('LANE_FULL')
  })

  // El orden de los tres controles es el de `join`: carril, tope del carril, tope de la cola. Estos
  // dos casos fallan dos controles a la vez y fijan cuál gana.
  it('si falla el carril y la cola está llena, gana el carril', () => {
    const state = queueState({ maxSize: 1 })
    state.lanes = [small(), lane('big', { minPartySize: 5, active: false })]
    state.entries.push(entry('a', 1, { laneId: 'small' }), entry('gone', 2, { laneId: 'big', partySize: 6, ...FINISHED }))
    expect(codeOf(() => requeue(session(state), 'gone', STAFF))).toBe('NO_COMPATIBLE_LANE')
  })

  it('si el carril y la cola están llenos, gana el tope del carril', () => {
    const state = queueState({ maxSize: 1 })
    state.lanes = [small({ maxSize: 1 })]
    state.entries.push(entry('a', 1, { laneId: 'small' }), entry('gone', 2, { laneId: 'small', ...FINISHED }))
    expect(codeOf(() => requeue(session(state), 'gone', STAFF))).toBe('LANE_FULL')
  })

  it('a alguien llamado no le aplica nada de esto: ya cuenta en su carril', () => {
    const state = queueState()
    state.lanes = [small({ maxSize: 1 })]
    state.entries.push(entry('a', 1, { laneId: 'small', status: 'CALLED' }))
    const back = requeue(session(state), 'a', STAFF)
    expect(back).toMatchObject({ status: 'WAITING', laneId: 'small' })
  })
})

describe('cerrar una cola', () => {
  it('cerrar es inmediato y deja el evento para que lifecycle libere la fila', () => {
    const state = queueState()
    state.entries.push(entry('a', 1), entry('b', 2, { status: 'CALLED' }))
    const s = session(state)
    changeStatus(s, 'CLOSED', STAFF)
    expect(s.queue.status).toBe('CLOSED')
    expect(s.events.map((event) => event.type)).toEqual(['QUEUE_STATUS_CHANGED', 'QUEUE_CLOSED'])
    expect(codeOf(() => join(s, { name: 'X', email: 'x@y.z' }))).toBe('QUEUE_NOT_ACCEPTING')
  })

  it('a quien ya está en el mostrador no lo libera: el staff lo termina de atender', () => {
    const state = queueState({ status: 'CLOSED' })
    const startedAt = new Date(NOW.getTime() - 60_000).toISOString()
    state.entries.push(entry('a', 1), entry('serving', 2, { status: 'SERVING', servingStartedAt: startedAt }))
    const s = session(state)
    expect(releaseBatch(s, 10, STAFF)).toBe(1)
    expect(releaseBatch(s, 10, STAFF)).toBe(0)
    expect(s.findEntry('serving')?.status).toBe('SERVING')
    expect(markServed(s, 'serving', STAFF).status).toBe('SERVED')
  })

  it('traer de vuelta a alguien respeta el tope de la cola', () => {
    const state = queueState({ maxSize: 1 })
    state.entries.push(entry('a', 1), entry('gone', 2, { status: 'LEFT', finishedAt: NOW.toISOString() }))
    expect(codeOf(() => requeue(session(state), 'gone', STAFF))).toBe('QUEUE_FULL')
  })

  it('libera en lotes, primero a los que estaban llamados', () => {
    const state = queueState({ status: 'CLOSED' })
    state.entries.push(entry('a', 1), entry('b', 2), entry('c', 3, { status: 'CALLED' }))
    const s = session(state)
    expect(releaseBatch(s, 2, STAFF)).toBe(2)
    expect(state.entries.filter((candidate) => candidate.status === 'LEFT').map((candidate) => candidate.id)).toEqual([
      'a',
      'c',
    ])
    expect(releaseBatch(s, 2, STAFF)).toBe(1)
    expect(releaseBatch(s, 2, STAFF)).toBe(0)
    expect(s.events.every((event) => event.detail['reason'] === 'QUEUE_CLOSED')).toBe(true)
  })

  it('una cola abierta no se libera', () => {
    const state = queueState()
    state.entries.push(entry('a', 1))
    expect(releaseBatch(session(state), 10, STAFF)).toBe(0)
  })
})
