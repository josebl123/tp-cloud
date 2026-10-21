// Configuración y ciclo de vida de una cola, y la gestión de sus carriles.

import { LIMITS } from './entries.js'
import { conflict, notFound, validation } from './errors.js'
import { expireDue } from './grace.js'
import { isLive, requireAnotherActiveLane, requireNameFree, validateLane, validateOverlap } from './lanes.js'
import type { Actor, QueueState, Session } from './state.js'
import type { CallStrategy, Lane, LaneCapacityMode, NoShowPolicy, Queue, QueueStatus } from './types.js'
import { isActive } from './types.js'

export interface QueueSettings {
  name?: string
  description?: string | null
  serviceStations?: number
  defaultServiceMinutes?: number
  maxSize?: number | null
  gracePeriodSeconds?: number
  noShowPolicy?: NoShowPolicy
  moveBackPositions?: number
  notifyAtPosition?: number | null
  notifyAtMinutes?: number | null
  requirePartySize?: boolean
  callStrategy?: CallStrategy
}

export interface LaneSettings {
  name: string
  minPartySize: number
  maxPartySize?: number | null
  priority: number
  capacityMode?: LaneCapacityMode
  maxSize?: number | null
  timeFactor?: number
  active?: boolean
}

/** El nombre del carril único que tiene toda cola recién creada. */
export const DEFAULT_LANE_NAME = '1+'

/** Una cola nueva con los mismos valores por defecto que la versión Java, y su carril `1+`. */
export function newQueueState(
  ids: { queueId: string; laneId: string },
  establishmentId: string,
  settings: QueueSettings & { name: string },
  now: Date,
): QueueState {
  const at = now.toISOString()
  const queue: Queue = {
    id: ids.queueId,
    establishmentId,
    name: settings.name.trim(),
    description: null,
    status: 'OPEN',
    archivedAt: null,
    serviceStations: 1,
    defaultServiceMinutes: 5,
    maxSize: null,
    gracePeriodSeconds: 120,
    noShowPolicy: 'MOVE_TO_END',
    moveBackPositions: 3,
    notifyAtPosition: null,
    notifyAtMinutes: null,
    requirePartySize: false,
    callStrategy: 'GLOBAL_AGE',
    roundRobinPosition: 0,
    nextTicketNumber: 1,
    nextOrderSequence: 1,
    recentServiceSeconds: [],
    version: 0,
    createdAt: at,
    updatedAt: at,
  }
  applySettings(queue, settings)
  validateQueue(queue)
  const lane: Lane = {
    id: ids.laneId,
    queueId: ids.queueId,
    name: DEFAULT_LANE_NAME,
    minPartySize: 1,
    maxPartySize: null,
    priority: 0,
    capacityMode: 'GROUPS',
    maxSize: null,
    timeFactor: 1,
    active: true,
    createdAt: at,
    deletedAt: null,
  }
  return { queue, lanes: [lane], entries: [] }
}

/** Cambia la configuración. Solo el dueño puede, y eso lo verifica quien llama. */
export function updateQueue(session: Session, settings: QueueSettings, actor: Actor): Queue {
  requireNotArchived(session.queue)
  // Se valida una copia: un valor inválido no puede dejar la cola a medio cambiar.
  const candidate = { ...session.queue }
  applySettings(candidate, settings)
  validateQueue(candidate)
  Object.assign(session.queue, candidate)
  session.touchQueue()
  session.record('QUEUE_UPDATED', actor, null)
  return session.queue
}

/**
 * Pausar, reanudar o cerrar. Cerrar es inmediato y atómico: desde ese momento no entra ni se llama a
 * nadie. A quienes quedaban adentro los libera `λ lifecycle` en lotes, al recibir `QUEUE_CLOSED`.
 */
export function changeStatus(session: Session, status: QueueStatus, actor: Actor): Queue {
  const queue = session.queue
  requireNotArchived(queue)
  const previous = queue.status
  if (previous === status) return queue

  expireDue(session)
  queue.status = status
  session.touchQueue()
  session.record('QUEUE_STATUS_CHANGED', actor, null, { from: previous, to: status })
  if (status === 'CLOSED') {
    const pending = session.state.entries.filter((entry) => isActive(entry.status)).length
    session.record('QUEUE_CLOSED', actor, null, { pendingEntries: pending })
  }
  return queue
}

/**
 * Archivar en lugar de borrar: la cola se cierra y se oculta, pero sus entradas y eventos quedan,
 * así las métricas históricas siguen siendo honestas.
 */
export function archiveQueue(session: Session, actor: Actor): Queue {
  const queue = session.queue
  if (queue.archivedAt !== null) return queue
  changeStatus(session, 'CLOSED', actor)
  queue.archivedAt = session.nowIso
  session.touchQueue()
  session.record('QUEUE_ARCHIVED', actor, null)
  return queue
}

export function createLane(session: Session, laneId: string, settings: LaneSettings, actor: Actor): Lane {
  requireLanesEditable(session.queue)
  const name = settings.name.trim()
  requireNameFree(session.state.lanes, name, null)
  const lane: Lane = {
    id: laneId,
    queueId: session.queue.id,
    name,
    minPartySize: settings.minPartySize,
    maxPartySize: settings.maxPartySize ?? null,
    priority: settings.priority,
    capacityMode: settings.capacityMode ?? 'GROUPS',
    maxSize: settings.maxSize ?? null,
    timeFactor: settings.timeFactor ?? 1,
    active: settings.active ?? true,
    createdAt: session.nowIso,
    deletedAt: null,
  }
  validateLane(lane)
  validateOverlap(session.state.lanes, lane)
  session.state.lanes.push(lane)
  session.touchLane(lane)
  session.record('LANE_CHANGED', actor, null, { laneId, change: 'CREATED' })
  return lane
}

export function updateLane(session: Session, laneId: string, settings: LaneSettings, actor: Actor): Lane {
  requireLanesEditable(session.queue)
  const lane = requireLane(session, laneId)
  const name = settings.name.trim()
  requireNameFree(session.state.lanes, name, lane.id)
  const updated: Lane = {
    ...lane,
    name,
    minPartySize: settings.minPartySize,
    maxPartySize: settings.maxPartySize ?? null,
    priority: settings.priority,
    capacityMode: settings.capacityMode ?? 'GROUPS',
    maxSize: settings.maxSize ?? null,
    timeFactor: settings.timeFactor ?? 1,
    active: settings.active ?? lane.active,
  }
  validateLane(updated)
  if (!updated.active && lane.active) {
    requireAnotherActiveLane(session.state.lanes, lane.id)
    // Un carril inactivo sale de la rotación del round robin. Si todavía tuviera gente, esa gente
    // solo se llamaría cuando todos los demás carriles estén vacíos: en un turno con movimiento,
    // nunca. Igual que al retirarlo, primero hay que vaciarlo.
    requireNoActiveEntries(session, lane)
  }
  validateOverlap(session.state.lanes, updated)
  Object.assign(lane, updated)
  session.touchLane(lane)
  session.record('LANE_CHANGED', actor, null, { laneId, change: 'UPDATED' })
  return lane
}

/**
 * Retira un carril sin borrar su ítem: las entradas terminadas lo siguen referenciando, y conserva
 * en qué banda se atendió a cada uno y con qué factor de tiempo.
 */
export function retireLane(session: Session, laneId: string, actor: Actor): Lane {
  requireLanesEditable(session.queue)
  const lane = requireLane(session, laneId)
  if (lane.active) requireAnotherActiveLane(session.state.lanes, lane.id)
  requireNoActiveEntries(session, lane)
  lane.active = false
  lane.deletedAt = session.nowIso
  session.touchLane(lane)
  session.record('LANE_CHANGED', actor, null, { laneId, change: 'RETIRED' })
  return lane
}

/**
 * Rangos de la configuración. Además de los mínimos que la base Java tenía como CHECK, cada valor
 * tiene un techo: una gracia de mil millones de segundos no es una configuración, es un error que
 * rompe el cálculo de la fecha de vencimiento y deja una cadena de mensajes SQS durante años.
 */
export const QUEUE_BOUNDS = {
  name: 120,
  description: 500,
  serviceStations: { min: 1, max: 100 },
  defaultServiceMinutes: { min: 1, max: 480 },
  gracePeriodSeconds: { min: 0, max: 3600 },
  moveBackPositions: { min: 1, max: 1000 },
  notifyAtPosition: { min: 1, max: 1000 },
  notifyAtMinutes: { min: 1, max: 480 },
} as const

const inRange = (value: number, range: { min: number; max: number }) =>
  Number.isInteger(value) && value >= range.min && value <= range.max

const rangeMessage = (field: string, range: { min: number; max: number }) =>
  `${field} must be an integer between ${range.min} and ${range.max}`

/** Las restricciones de la configuración: un valor malo es un 400, no un 500. */
export function validateQueue(queue: Queue): void {
  const b = QUEUE_BOUNDS
  if (!queue.name) throw validation('QUEUE_NAME_REQUIRED', 'A queue name is required')
  if (queue.name.length > b.name) throw validation('QUEUE_NAME_TOO_LONG', `A queue name has at most ${b.name} characters`)
  if (queue.description !== null && queue.description.length > b.description) {
    throw validation('QUEUE_DESCRIPTION_TOO_LONG', `A description has at most ${b.description} characters`)
  }
  if (!inRange(queue.serviceStations, b.serviceStations)) {
    throw validation('INVALID_SERVICE_STATIONS', rangeMessage('serviceStations', b.serviceStations))
  }
  if (!inRange(queue.defaultServiceMinutes, b.defaultServiceMinutes)) {
    throw validation('INVALID_SERVICE_TIME', rangeMessage('defaultServiceMinutes', b.defaultServiceMinutes))
  }
  if (queue.maxSize !== null && !inRange(queue.maxSize, { min: 1, max: LIMITS.activeEntries })) {
    throw validation('INVALID_MAX_SIZE', rangeMessage('maxSize', { min: 1, max: LIMITS.activeEntries }))
  }
  if (!inRange(queue.gracePeriodSeconds, b.gracePeriodSeconds)) {
    throw validation('INVALID_GRACE_PERIOD', rangeMessage('gracePeriodSeconds', b.gracePeriodSeconds))
  }
  if (!inRange(queue.moveBackPositions, b.moveBackPositions)) {
    throw validation('INVALID_MOVE_BACK', rangeMessage('moveBackPositions', b.moveBackPositions))
  }
  if (queue.notifyAtPosition !== null && !inRange(queue.notifyAtPosition, b.notifyAtPosition)) {
    throw validation('INVALID_NOTIFY_POSITION', rangeMessage('notifyAtPosition', b.notifyAtPosition))
  }
  if (queue.notifyAtMinutes !== null && !inRange(queue.notifyAtMinutes, b.notifyAtMinutes)) {
    throw validation('INVALID_NOTIFY_MINUTES', rangeMessage('notifyAtMinutes', b.notifyAtMinutes))
  }
}

function applySettings(queue: Queue, settings: QueueSettings): void {
  if (settings.name !== undefined) queue.name = settings.name.trim()
  if (settings.description !== undefined) queue.description = settings.description?.trim() || null
  if (settings.serviceStations !== undefined) queue.serviceStations = settings.serviceStations
  if (settings.defaultServiceMinutes !== undefined) queue.defaultServiceMinutes = settings.defaultServiceMinutes
  if (settings.maxSize !== undefined) queue.maxSize = settings.maxSize
  if (settings.gracePeriodSeconds !== undefined) queue.gracePeriodSeconds = settings.gracePeriodSeconds
  if (settings.noShowPolicy !== undefined) queue.noShowPolicy = settings.noShowPolicy
  if (settings.moveBackPositions !== undefined) queue.moveBackPositions = settings.moveBackPositions
  if (settings.notifyAtPosition !== undefined) queue.notifyAtPosition = settings.notifyAtPosition
  if (settings.notifyAtMinutes !== undefined) queue.notifyAtMinutes = settings.notifyAtMinutes
  if (settings.requirePartySize !== undefined) queue.requirePartySize = settings.requirePartySize
  if (settings.callStrategy !== undefined) queue.callStrategy = settings.callStrategy
}

function requireNoActiveEntries(session: Session, lane: Lane): void {
  if (session.state.entries.some((entry) => entry.laneId === lane.id && isActive(entry.status))) {
    throw conflict('LANE_HAS_ACTIVE_ENTRIES', 'A lane with active entries cannot be deactivated or deleted')
  }
}

function requireNotArchived(queue: Queue): void {
  if (queue.archivedAt !== null) throw conflict('QUEUE_ARCHIVED', 'This queue is archived')
}

function requireLanesEditable(queue: Queue): void {
  if (queue.archivedAt !== null || queue.status === 'CLOSED') {
    throw conflict('QUEUE_ARCHIVED', 'Lanes cannot be changed on a closed or archived queue')
  }
}

function requireLane(session: Session, laneId: string): Lane {
  const lane = session.state.lanes.find((candidate) => candidate.id === laneId && isLive(candidate))
  if (!lane) throw notFound('LANE_NOT_FOUND', `Lane ${laneId} was not found`)
  return lane
}
