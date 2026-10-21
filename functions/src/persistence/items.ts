// Conversión entre los tipos del dominio y los ítems de DynamoDB.
//
// Un ítem es el objeto del dominio tal cual, más sus claves y un `kind` que dice qué es. Los campos
// del dominio no se renombran: así lo que se ve en la consola de DynamoDB es lo que lee el código.

import type { DomainEvent, Entry, Establishment, Lane, Membership, Queue } from '../domain/types.js'
import * as keys from './keys.js'

export type Item = Record<string, unknown>

const META_FIELDS = ['PK', 'SK', 'kind', 'ttl'] as const

/** Saca las claves y los metadatos de un ítem y lo devuelve como objeto del dominio. */
export function strip<T>(item: Item): T {
  const copy: Item = { ...item }
  for (const field of META_FIELDS) delete copy[field]
  return copy as T
}

/** Días que se conservan los eventos en la tabla. La auditoría completa queda en el stream. */
export const EVENT_RETENTION_DAYS = 30

export const queueItem = (queue: Queue): Item => ({
  PK: keys.queuePk(queue.id),
  SK: keys.QUEUE_META_SK,
  kind: 'QUEUE',
  ...queue,
})

export const laneItem = (lane: Lane): Item => ({
  PK: keys.queuePk(lane.queueId),
  SK: keys.laneSk(lane.id),
  kind: 'LANE',
  ...lane,
})

export const entryItem = (entry: Entry): Item => ({
  PK: keys.queuePk(entry.queueId),
  SK: keys.entrySk(entry),
  kind: 'ENTRY',
  ...entry,
})

export const ticketItem = (entry: Entry): Item => ({
  PK: keys.ticketPk(entry.ticketToken),
  SK: keys.TICKET_SK,
  kind: 'TICKET',
  queueId: entry.queueId,
  entryId: entry.id,
})

export const entryRefItem = (entry: Entry): Item => ({
  PK: keys.entryPk(entry.id),
  SK: keys.ENTRY_REF_SK,
  kind: 'ENTRY_REF',
  queueId: entry.queueId,
  ticketToken: entry.ticketToken,
  sk: keys.entrySk(entry),
})

/**
 * El evento de dominio como ítem. Es lo único que `λ stream-publisher` publica del stream: escribirlo
 * dentro de la misma transacción que el cambio es lo que garantiza que no hay cambio sin evento ni
 * evento sin cambio.
 */
export const eventItem = (event: DomainEvent, version: number, index: number, now: Date): Item => ({
  PK: keys.eventsPk(event.queueId),
  SK: keys.eventSk(version, index, event.id),
  kind: 'EVENT',
  queueVersion: version,
  ...event,
  ttl: keys.epochSeconds(now) + EVENT_RETENTION_DAYS * 24 * 3600,
})

/** Lo que muestra el listado de colas de un establecimiento, sin leer cada partición. */
export const establishmentQueueItem = (queue: Queue): Item => ({
  PK: keys.establishmentPk(queue.establishmentId),
  SK: keys.establishmentQueueSk(queue.id),
  kind: 'ESTABLISHMENT_QUEUE',
  queueId: queue.id,
  name: queue.name,
  status: queue.status,
  archivedAt: queue.archivedAt,
})

export const establishmentItem = (establishment: Establishment): Item => ({
  PK: keys.establishmentPk(establishment.id),
  SK: keys.ESTABLISHMENT_META_SK,
  kind: 'ESTABLISHMENT',
  ...establishment,
})

/** Una membresía se guarda dos veces: por usuario (sus locales) y por local (sus miembros). */
export const membershipItems = (membership: Membership): [Item, Item] => [
  {
    PK: keys.userPk(membership.userId),
    SK: keys.membershipSk(membership.establishmentId),
    kind: 'MEMBERSHIP',
    ...membership,
  },
  {
    PK: keys.establishmentPk(membership.establishmentId),
    SK: keys.memberSk(membership.userId),
    kind: 'MEMBER',
    ...membership,
  },
]
