// Cada movimiento de un cliente por la fila.
//
// Todas las operaciones empiezan venciendo las gracias que ya pasaron, igual que la versión Java:
// así nunca se decide sobre un llamado que el reloj ya invalidó. La serialización por cola, que antes
// daba el `SELECT … FOR UPDATE`, la da ahora la persistencia con la versión de la cola.

import { conflict, notFound, validation } from './errors.js'
import { recordServiceTime } from './estimation.js'
import { allocateEndKey, applyNoShow, expireDue } from './grace.js'
import { accepts, ensureLaneCapacity, selectLane } from './lanes.js'
import { rotation, select } from './selector.js'
import type { Actor, Session } from './state.js'
import { CUSTOMER } from './state.js'
import type { Entry, EntryStatus, SupportedLocale } from './types.js'
import { isActive, isTerminal } from './types.js'

export interface JoinCommand {
  name: string | null | undefined
  email?: string | null | undefined
  phone?: string | null | undefined
  partySize?: number | null | undefined
  locale?: SupportedLocale | null | undefined
}

const trimmed = (value: string | null | undefined): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text : null
}

/**
 * Límites de lo que escribe un cliente anónimo. No son estéticos: cada mutación de una cola lee
 * todas sus entradas activas, así que un nombre de 300 KB repetido en cada entrada haría que operar
 * la cola costara megabytes de lectura por acción (y DynamoDB rechaza ítems de más de 400 KB).
 */
export const LIMITS = {
  name: 120,
  email: 254,
  phone: 32,
  partySize: 50,
  /** Techo absoluto de entradas activas por cola, aunque `maxSize` no esté configurado. */
  activeEntries: 1000,
} as const

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^\+?[0-9 ()-]{6,32}$/
const LOCALES: readonly SupportedLocale[] = ['en', 'es']

/** El tope efectivo de la cola: su `maxSize` o, si no tiene, el techo absoluto. */
export const capacityOf = (maxSize: number | null): number => Math.min(maxSize ?? LIMITS.activeEntries, LIMITS.activeEntries)

/** Funcionalidad 1: un cliente escanea el QR y toma un lugar. */
export function join(session: Session, command: JoinCommand): Entry {
  expireDue(session)
  const queue = session.queue

  const name = trimmed(command.name)
  if (!name) throw validation('CUSTOMER_NAME_REQUIRED', 'A name is required')
  if (name.length > LIMITS.name) throw validation('CUSTOMER_NAME_TOO_LONG', `A name has at most ${LIMITS.name} characters`)
  const email = trimmed(command.email)?.toLowerCase() ?? null
  const phone = trimmed(command.phone)
  if (!email && !phone) {
    throw validation(
      'CONTACT_REQUIRED',
      'An email address or a phone number is required so we can send you your ticket link',
    )
  }
  if (email !== null && (email.length > LIMITS.email || !EMAIL_PATTERN.test(email))) {
    throw validation('INVALID_EMAIL', 'The email address is not valid')
  }
  if (phone !== null && !PHONE_PATTERN.test(phone)) {
    throw validation('INVALID_PHONE', 'The phone number is not valid')
  }
  if (queue.status !== 'OPEN' || queue.archivedAt !== null) {
    throw conflict(
      'QUEUE_NOT_ACCEPTING',
      `This queue is ${queue.archivedAt ? 'archived' : queue.status.toLowerCase()} and is not taking new customers`,
    )
  }

  // Una farmacia o un banco no tienen noción de grupo: una persona es el valor honesto por defecto.
  const partySize = command.partySize ?? 1
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > LIMITS.partySize) {
    throw validation('INVALID_PARTY_SIZE', `partySize must be an integer between 1 and ${LIMITS.partySize}`)
  }
  const lane = selectLane(session.state.lanes, partySize)
  ensureLaneCapacity(lane, session.state.entries, partySize)
  requireRoom(session)

  const entry: Entry = {
    id: session.newId(),
    queueId: queue.id,
    laneId: lane.id,
    ticketToken: session.newId(),
    ticketNumber: queue.nextTicketNumber,
    customerName: name,
    customerEmail: email,
    customerPhone: phone,
    partySize,
    // Un idioma desconocido cae en inglés en lugar de rechazar a nadie.
    locale: command.locale && LOCALES.includes(command.locale) ? command.locale : 'en',
    status: 'WAITING',
    orderKey: allocateEndKey(session),
    notificationCycle: 0,
    noShowCount: 0,
    joinedAt: session.nowIso,
    calledAt: null,
    servingStartedAt: null,
    finishedAt: null,
    graceExpiresAt: null,
  }
  queue.nextTicketNumber += 1
  session.touchQueue()
  session.addEntry(entry)
  session.record('ENTRY_JOINED', CUSTOMER, entry, { ticketNumber: entry.ticketNumber, laneId: lane.id })
  return entry
}

/** Funcionalidad 5: el cliente deja su lugar. */
export function leave(session: Session, entryId: string): Entry {
  expireDue(session)
  const entry = requireEntry(session, entryId)
  if (isTerminal(entry.status)) {
    throw conflict('ENTRY_NOT_ACTIVE', `This ticket is already ${entry.status.toLowerCase()}`)
  }
  release(session, entry, CUSTOMER)
  return entry
}

/** Funcionalidad 4: llamar a quien sigue según la estrategia de la cola, o al primero de un carril. */
export function callNext(session: Session, actor: Actor, laneId?: string): Entry {
  expireDue(session)
  requireOperable(session)
  const queue = session.queue

  let waiting = session.waiting()
  if (laneId !== undefined) waiting = waiting.filter((entry) => entry.laneId === laneId)
  if (waiting.length === 0) {
    throw conflict('QUEUE_EMPTY', laneId ? 'There is nobody waiting in this lane' : 'There is nobody waiting in this queue')
  }

  let entry: Entry
  if (laneId !== undefined) {
    entry = waiting[0] as Entry
  } else {
    const selection = select(
      queue.callStrategy,
      session.state.lanes,
      rotation(session.state.lanes),
      waiting,
      queue.roundRobinPosition,
    )
    entry = selection.entry
    if (queue.callStrategy === 'ROUND_ROBIN' && selection.nextRoundRobinPosition !== queue.roundRobinPosition) {
      queue.roundRobinPosition = selection.nextRoundRobinPosition
      session.touchQueue()
    }
  }
  doCall(session, entry, actor)
  return entry
}

/** Llama a alguien puntual: así el staff se saltea a quien no está. */
export function call(session: Session, entryId: string, actor: Actor): Entry {
  expireDue(session)
  requireOperable(session)
  const entry = requireEntry(session, entryId)
  doCall(session, entry, actor)
  return entry
}

/** El cliente se presentó y lo están atendiendo. */
export function startServing(session: Session, entryId: string, actor: Actor): Entry {
  expireDue(session)
  const entry = requireEntry(session, entryId)
  requireStatus(entry, 'CALLED')
  entry.status = 'SERVING'
  entry.servingStartedAt = session.nowIso
  entry.graceExpiresAt = null
  session.touchEntry(entry)
  session.record('ENTRY_SERVING_STARTED', actor, entry)
  return entry
}

/** Terminó el servicio. Es la medición que alimenta todas las esperas futuras. */
export function markServed(session: Session, entryId: string, actor: Actor): Entry {
  expireDue(session)
  const entry = requireEntry(session, entryId)
  requireStatus(entry, 'CALLED', 'SERVING')

  // Si el staff pasó directo de "llamado" a "listo", el llamado cuenta como inicio, así la duración
  // igual entra en el promedio.
  entry.servingStartedAt ??= entry.calledAt ?? session.nowIso
  entry.status = 'SERVED'
  entry.finishedAt = session.nowIso
  entry.graceExpiresAt = null

  const seconds = (session.now.getTime() - Date.parse(entry.servingStartedAt)) / 1000
  session.queue.recentServiceSeconds = recordServiceTime(session.queue.recentServiceSeconds, seconds)
  session.touchQueue()
  session.touchEntry(entry)
  session.record('ENTRY_SERVED', actor, entry, { serviceSeconds: Math.round(seconds) })
  return entry
}

/** El staff declara ausente al cliente sin esperar a que venza la gracia. */
export function markNoShow(session: Session, entryId: string, actor: Actor): Entry {
  expireDue(session)
  const entry = requireEntry(session, entryId)
  requireStatus(entry, 'CALLED')
  applyNoShow(session, entry, actor)
  return entry
}

/** El staff saca a alguien de la fila. */
export function cancel(session: Session, entryId: string, actor: Actor): Entry {
  expireDue(session)
  const entry = requireEntry(session, entryId)
  if (isTerminal(entry.status)) {
    throw conflict('ENTRY_NOT_ACTIVE', `This entry is already ${entry.status.toLowerCase()}`)
  }
  release(session, entry, actor)
  return entry
}

/**
 * Devuelve una entrada a la fila. Deshacer un llamado conserva el lugar; traer de vuelta a alguien
 * que ya se había ido o estaba ausente lo pone al final, porque su clave vieja ya no significa nada.
 */
export function requeue(session: Session, entryId: string, actor: Actor): Entry {
  expireDue(session)
  requireOperable(session)
  const entry = requireEntry(session, entryId)
  if (entry.status === 'WAITING') throw conflict('ALREADY_WAITING', 'This entry is already waiting')

  const wasTerminal = isTerminal(entry.status)
  // Traer de vuelta a alguien que ya no estaba es un ingreso nuevo, con los mismos controles y en el
  // mismo orden que `join`. Su carril puede haberse apagado o retirado mientras estaba afuera: la
  // regla que impide apagar un carril con gente solo cuenta a los activos, y quien ya había terminado
  // no lo es. Sin esto volvía a esperar en un carril que el round robin no visita, o que el tablero no
  // muestra. A alguien llamado o en atención no le aplica: su carril no se pudo apagar y él ya cuenta
  // dentro de su capacidad.
  const previousLaneId = entry.laneId
  if (wasTerminal) {
    const own = session.state.lanes.find((candidate) => candidate.id === entry.laneId)
    const lane = own && accepts(own, entry.partySize) ? own : selectLane(session.state.lanes, entry.partySize)
    ensureLaneCapacity(lane, session.state.entries, entry.partySize)
    requireRoom(session)
    entry.laneId = lane.id
  }
  entry.status = 'WAITING'
  entry.calledAt = null
  entry.servingStartedAt = null
  entry.finishedAt = null
  entry.graceExpiresAt = null
  entry.notificationCycle += 1
  if (wasTerminal) entry.orderKey = allocateEndKey(session)
  session.touchEntry(entry)
  session.record('ENTRY_REQUEUED', actor, entry, {
    placement: wasTerminal ? 'END' : 'KEEP_POSITION',
    // Solo si cambió: así el historial de esa persona cuenta por qué ahora espera en otro carril.
    ...(entry.laneId === previousLaneId ? {} : { laneId: entry.laneId, previousLaneId }),
  })
  return entry
}

/** El único punto de entrada detrás de `PUT /entries/{id}/status`. */
export function transition(session: Session, entryId: string, target: EntryStatus, actor: Actor): Entry {
  switch (target) {
    case 'CALLED':
      return call(session, entryId, actor)
    case 'SERVING':
      return startServing(session, entryId, actor)
    case 'SERVED':
      return markServed(session, entryId, actor)
    case 'NO_SHOW':
      return markNoShow(session, entryId, actor)
    case 'LEFT':
      return cancel(session, entryId, actor)
    case 'WAITING':
      return requeue(session, entryId, actor)
  }
}

/**
 * Cuántas entradas libera `λ lifecycle` por transacción. Cada una escribe cuatro ítems (borrar su SK
 * viejo, escribir el nuevo, actualizar su referencia y su evento) y la cola uno más: 24 × 4 + 1 = 97,
 * por debajo de los 100 de una transacción de DynamoDB.
 */
export const RELEASE_BATCH_SIZE = 24

/**
 * Libera hasta `limit` entradas de una cola cerrada. Lo usa `λ lifecycle` en lotes, para que ninguna
 * transacción pase el límite de 100 ítems de DynamoDB.
 *
 * A quien ya se está atendiendo (SERVING) no se lo libera: cerrar a fin del día con el último cliente
 * en el mostrador no puede mandarle "la cola cerró" ni registrarlo como abandono. El staff lo termina
 * de atender y lo marca como atendido, que en una cola cerrada sigue permitido.
 *
 * @returns cuántas liberó; cero significa que ya no queda nadie por liberar
 */
export function releaseBatch(session: Session, limit: number, actor: Actor): number {
  if (session.queue.status !== 'CLOSED') return 0
  const called = session.inService().filter((entry) => entry.status === 'CALLED')
  const batch = [...called, ...session.waiting()].slice(0, Math.max(0, limit))
  for (const entry of batch) release(session, entry, actor, { reason: 'QUEUE_CLOSED' })
  return batch.length
}

// ----------------------------------------------------------------------------- internos

function doCall(session: Session, entry: Entry, actor: Actor): void {
  requireStatus(entry, 'WAITING')
  const grace = session.queue.gracePeriodSeconds
  entry.status = 'CALLED'
  entry.calledAt = session.nowIso
  // Una gracia de cero significa que el establecimiento no quiere ausencias automáticas.
  entry.graceExpiresAt = grace > 0 ? new Date(session.now.getTime() + grace * 1000).toISOString() : null
  session.touchEntry(entry)
  session.record('ENTRY_CALLED', actor, entry, {
    graceSeconds: grace,
    graceExpiresAt: entry.graceExpiresAt,
  })
}

function release(session: Session, entry: Entry, actor: Actor, detail: Record<string, string> = {}): void {
  entry.status = 'LEFT'
  entry.finishedAt = session.nowIso
  entry.graceExpiresAt = null
  session.touchEntry(entry)
  session.record('ENTRY_LEFT', actor, entry, detail)
}

function requireEntry(session: Session, entryId: string): Entry {
  const entry = session.findEntry(entryId)
  if (!entry) throw notFound('ENTRY_NOT_FOUND', `Entry ${entryId} was not found`)
  return entry
}

function requireRoom(session: Session): void {
  const active = session.state.entries.filter((entry) => isActive(entry.status)).length
  if (active + 1 > capacityOf(session.queue.maxSize)) {
    throw conflict('QUEUE_FULL', 'This queue has reached its maximum size')
  }
}

function requireOperable(session: Session): void {
  if (session.queue.status === 'CLOSED' || session.queue.archivedAt !== null) {
    throw conflict('QUEUE_CLOSED', 'This queue is closed')
  }
}

function requireStatus(entry: Entry, ...allowed: EntryStatus[]): void {
  if (!allowed.includes(entry.status)) {
    throw conflict(
      'INVALID_TRANSITION',
      `An entry in status ${entry.status} cannot make this transition (expected one of ${allowed.join(', ')})`,
    )
  }
}
