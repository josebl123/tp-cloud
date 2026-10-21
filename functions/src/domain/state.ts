// El estado de una cola en un instante, y el registro de lo que una operación cambió en él.
//
// Las operaciones del dominio reciben una sesión, modifican su estado en memoria y anotan qué tocaron.
// La persistencia después convierte esas anotaciones en una sola transacción de DynamoDB,
// condicionada a la versión que se leyó. Así las reglas no saben nada de DynamoDB, y DynamoDB no
// sabe nada de las reglas.

import { randomUUID } from 'node:crypto'
import { compareByOrder } from './ordering.js'
import type { ActorType, DomainEvent, Entry, EventType, Lane, Queue } from './types.js'
import { IN_SERVICE_STATUSES } from './types.js'

export interface QueueState {
  queue: Queue
  /** Todos los carriles, también los retirados: una entrada vieja puede seguir apuntando a uno. */
  lanes: Lane[]
  /** Las entradas activas, más cualquier terminada que la operación haya pedido leer. */
  entries: Entry[]
}

export interface Actor {
  type: ActorType
  id: string | null
}

export const SYSTEM: Actor = { type: 'SYSTEM', id: null }
export const CUSTOMER: Actor = { type: 'CUSTOMER', id: null }
export const staff = (userId: string): Actor => ({ type: 'STAFF', id: userId })

export class Session {
  readonly events: DomainEvent[] = []
  readonly touchedEntries = new Set<string>()
  readonly touchedLanes = new Set<string>()
  /** Lo que una entrada tenía al leerse, para que la persistencia sepa qué ítem reemplazar. */
  readonly original = new Map<string, Entry>()
  /** La cola como se leyó, antes de cualquier cambio de esta sesión. */
  readonly originalQueue: Queue
  private queueTouched = false

  constructor(
    readonly state: QueueState,
    readonly now: Date,
    readonly newId: () => string = randomUUID,
  ) {
    for (const entry of state.entries) this.original.set(entry.id, { ...entry })
    this.originalQueue = { ...state.queue, recentServiceSeconds: [...state.queue.recentServiceSeconds] }
  }

  get queue(): Queue {
    return this.state.queue
  }

  get nowIso(): string {
    return this.now.toISOString()
  }

  /** La fila: las entradas que esperan, en orden. */
  waiting(): Entry[] {
    return this.state.entries.filter((entry) => entry.status === 'WAITING').sort(compareByOrder)
  }

  /** Los llamados y los que se están atendiendo, en orden de llegada. */
  inService(): Entry[] {
    return this.state.entries.filter((entry) => IN_SERVICE_STATUSES.includes(entry.status)).sort(compareByOrder)
  }

  findEntry(entryId: string): Entry | undefined {
    return this.state.entries.find((entry) => entry.id === entryId)
  }

  addEntry(entry: Entry): void {
    this.state.entries.push(entry)
    this.touchedEntries.add(entry.id)
  }

  touchEntry(entry: Entry): void {
    this.touchedEntries.add(entry.id)
  }

  touchQueue(): void {
    this.queueTouched = true
    this.state.queue.updatedAt = this.nowIso
  }

  touchLane(lane: Lane): void {
    this.touchedLanes.add(lane.id)
  }

  get hasChanges(): boolean {
    return this.queueTouched || this.touchedEntries.size > 0 || this.touchedLanes.size > 0 || this.events.length > 0
  }

  record(
    type: EventType,
    actor: Actor,
    entry: Entry | null,
    detail: DomainEvent['detail'] = {},
  ): DomainEvent {
    const event: DomainEvent = {
      id: this.newId(),
      queueId: this.state.queue.id,
      entryId: entry?.id ?? null,
      type,
      actorType: actor.type,
      actorId: actor.id,
      cycle: entry?.notificationCycle ?? null,
      detail,
      occurredAt: this.nowIso,
    }
    this.events.push(event)
    return event
  }
}
