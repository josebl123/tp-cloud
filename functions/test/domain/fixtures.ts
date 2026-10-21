import { keyForSequence } from '../../src/domain/ordering.js'
import { newQueueState } from '../../src/domain/queues.js'
import type { QueueState } from '../../src/domain/state.js'
import { Session } from '../../src/domain/state.js'
import type { Entry, Lane, Queue } from '../../src/domain/types.js'

export const NOW = new Date('2026-03-02T15:00:00.000Z')

let counter = 0
/** Ids deterministas y legibles en los mensajes de error de los tests. */
export const sequentialIds = (prefix = 'id') => () => `${prefix}-${String(++counter).padStart(4, '0')}`

export function queueState(overrides: Partial<Queue> = {}): QueueState {
  const state = newQueueState({ queueId: 'queue-1', laneId: 'lane-default' }, 'est-1', { name: 'Mesas' }, NOW)
  Object.assign(state.queue, overrides)
  return state
}

export function lane(id: string, overrides: Partial<Lane> = {}): Lane {
  return {
    id,
    queueId: 'queue-1',
    name: id,
    minPartySize: 1,
    maxPartySize: null,
    priority: 0,
    capacityMode: 'GROUPS',
    maxSize: null,
    timeFactor: 1,
    active: true,
    createdAt: NOW.toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

/** Una entrada esperando. `sequence` decide su lugar: menor, más adelante. */
export function entry(id: string, sequence: number, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    queueId: 'queue-1',
    laneId: 'lane-default',
    ticketToken: `token-${id}`,
    ticketNumber: sequence,
    customerName: id,
    customerEmail: `${id}@example.com`,
    customerPhone: null,
    partySize: 1,
    locale: 'es',
    status: 'WAITING',
    orderKey: keyForSequence(sequence),
    notificationCycle: 0,
    noShowCount: 0,
    joinedAt: new Date(NOW.getTime() - (1000 - sequence) * 1000).toISOString(),
    calledAt: null,
    servingStartedAt: null,
    finishedAt: null,
    graceExpiresAt: null,
    ...overrides,
  }
}

/** Una sesión sobre un estado, con la secuencia de la cola por encima de todas las entradas. */
export function session(state: QueueState, now: Date = NOW): Session {
  const highest = state.entries.reduce((max, candidate) => Math.max(max, candidate.ticketNumber), 0)
  state.queue.nextOrderSequence = Math.max(state.queue.nextOrderSequence, highest + 1)
  state.queue.nextTicketNumber = Math.max(state.queue.nextTicketNumber, highest + 1)
  return new Session(state, now, sequentialIds())
}

export const ids = (entries: readonly { id: string }[]) => entries.map((candidate) => candidate.id)
