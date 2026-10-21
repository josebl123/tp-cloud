// Las respuestas de la API, con la forma exacta de la versión Java (QueueViewFactory y compañía): el
// frontend lee estos tipos tal cual y no tiene que enterarse de que cambió el backend.

import { capacityOf } from '../domain/entries.js'
import { badRequest, HttpError } from '../http/api.js'
import { DomainError } from '../domain/errors.js'
import { averageServiceTime, simulateAll, toMinutes } from '../domain/estimation.js'
import { ensureLaneCapacity, isLive, selectLane } from '../domain/lanes.js'
import type { Metrics, MetricsWindow } from '../domain/metrics.js'
import type { QueueState } from '../domain/state.js'
import type {
  DomainEvent,
  Entry,
  Establishment,
  Lane,
  Membership,
  MembershipRole,
  NotificationRecord,
  Queue,
} from '../domain/types.js'
import { isActive } from '../domain/types.js'
import type { EntryView, QueueSummary } from '../domain/views.js'
import { entryView, snapshot } from '../domain/views.js'

export type MetricsRange = 'TODAY' | 'LAST_7_DAYS'
export const RANGE_DAYS: Record<MetricsRange, number> = { TODAY: 1, LAST_7_DAYS: 7 }

export const joinUrl = (baseUrl: string, queueId: string) => `${baseUrl}/q/?id=${queueId}`
export const ticketUrl = (baseUrl: string, token: string) => `${baseUrl}/t/?token=${token}`

// ------------------------------------------------------------------------------------- carriles

export interface QueueLaneView {
  id: string
  name: string
  minPartySize: number
  maxPartySize: number | null
  priority: number
  capacityMode: Lane['capacityMode']
  maxSize: number | null
  timeFactor: number
  active: boolean
}

export const laneView = (lane: Lane): QueueLaneView => ({
  id: lane.id,
  name: lane.name,
  minPartySize: lane.minPartySize,
  maxPartySize: lane.maxPartySize,
  priority: lane.priority,
  capacityMode: lane.capacityMode,
  maxSize: lane.maxSize,
  timeFactor: lane.timeFactor,
  active: lane.active,
})

/** Los carriles que no se retiraron, por prioridad y por tamaño, como los mostraba la versión Java. */
export const liveLanes = (lanes: readonly Lane[]): Lane[] =>
  lanes
    .filter(isLive)
    .sort((a, b) => a.priority - b.priority || a.minPartySize - b.minPartySize || (a.id < b.id ? -1 : 1))

// ------------------------------------------------------------------------------------- colas

export function queueView(queue: Queue, lanes: readonly Lane[], establishmentName: string, baseUrl: string) {
  return {
    id: queue.id,
    establishmentId: queue.establishmentId,
    establishmentName,
    name: queue.name,
    description: queue.description,
    status: queue.status,
    serviceStations: queue.serviceStations,
    defaultServiceMinutes: queue.defaultServiceMinutes,
    maxSize: queue.maxSize,
    gracePeriodSeconds: queue.gracePeriodSeconds,
    noShowPolicy: queue.noShowPolicy,
    moveBackPositions: queue.moveBackPositions,
    notifyAtPosition: queue.notifyAtPosition,
    notifyAtMinutes: queue.notifyAtMinutes,
    joinUrl: joinUrl(baseUrl, queue.id),
    createdAt: queue.createdAt,
    updatedAt: queue.updatedAt,
    archivedAt: queue.archivedAt,
    lanes: liveLanes(lanes).map(laneView),
    callStrategy: queue.callStrategy,
  }
}

export const queueSummary = (queue: Queue, establishmentName: string): QueueSummary => ({
  id: queue.id,
  name: queue.name,
  description: queue.description,
  status: queue.status,
  establishmentId: queue.establishmentId,
  establishmentName,
})

/** El tablero del staff: la fila con posiciones y esperas, y el mismo corte por carril. */
export function boardView(state: QueueState, establishmentName: string, baseUrl: string, now: Date) {
  const snap = snapshot(state)
  const view = (entry: Entry): EntryView => entryView(snap, entry, now)

  const lanes = liveLanes(state.lanes).map((lane) => {
    const waiting = snap.waiting.filter((entry) => entry.laneId === lane.id)
    const inService = snap.inService.filter((entry) => entry.laneId === lane.id)
    const units = (entry: Entry) => (lane.capacityMode === 'PERSONS' ? entry.partySize : 1)
    return {
      lane: laneView(lane),
      waiting: waiting.map(view),
      // Como en la versión Java, los que se atienden en un carril cuentan solo los de ese carril.
      inService: inService.map((entry) => ({ ...view(entry), groupsInService: inService.length })),
      waitingGroups: waiting.length,
      waitingPersons: waiting.reduce((sum, entry) => sum + entry.partySize, 0),
      capacityUsed: [...waiting, ...inService].reduce((sum, entry) => sum + units(entry), 0),
      capacityMaximum: lane.maxSize,
    }
  })

  return {
    queue: queueView(state.queue, state.lanes, establishmentName, baseUrl),
    waiting: snap.waiting.map(view),
    inService: snap.inService.map(view),
    waitingCount: snap.waiting.length,
    inServiceCount: snap.inService.length,
    averageServiceMinutes: snap.averageServiceMinutes,
    usingDefaultServiceTime: snap.usingDefaultServiceTime,
    generatedAt: now.toISOString(),
    lanes,
  }
}

const acceptsEntries = (queue: Queue) => queue.status === 'OPEN' && queue.archivedAt === null

/** La página de ingreso, lo que ve alguien que escaneó el QR. Sin datos de otros clientes. */
export function publicQueueView(state: QueueState, establishmentName: string) {
  const queue = state.queue
  const waitingCount = state.entries.filter((entry) => entry.status === 'WAITING').length
  const active = state.entries.filter((entry) => isActive(entry.status)).length
  const full = active >= capacityOf(queue.maxSize)
  return {
    id: queue.id,
    name: queue.name,
    description: queue.description,
    establishmentName,
    status: queue.status,
    acceptingEntries: acceptsEntries(queue) && !full,
    full,
    waitingCount,
    maxSize: queue.maxSize,
    lanes: liveLanes(state.lanes).filter((lane) => lane.active).map(laneView),
  }
}

/** Antes de unirse: en qué carril caería un grupo de ese tamaño, si hay lugar y cuánto esperaría. */
export function availabilityView(state: QueueState, partySize: number) {
  const queue = state.queue
  const waiting = state.entries.filter((entry) => entry.status === 'WAITING')
  const inService = state.entries.filter((entry) => entry.status === 'CALLED' || entry.status === 'SERVING')

  let lane: Lane
  try {
    lane = selectLane(state.lanes, partySize)
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NO_COMPATIBLE_LANE') {
      return {
        lane: null,
        eligible: false,
        available: false,
        queueFull: false,
        laneFull: false,
        globalWaitingGroupsAhead: waiting.length,
        groupsInService: inService.length,
      }
    }
    throw error
  }

  const active = state.entries.filter((entry) => isActive(entry.status)).length
  const queueFull = active >= capacityOf(queue.maxSize)
  let laneFull = false
  try {
    ensureLaneCapacity(lane, state.entries, partySize)
  } catch (error) {
    if (!(error instanceof DomainError && error.code === 'LANE_FULL')) throw error
    laneFull = true
  }

  // Un candidato al final de la fila, que nunca se guarda: la misma simulación que el tablero.
  const candidate = {
    id: 'candidate',
    laneId: lane.id,
    partySize,
    status: 'WAITING',
    orderKey: '￿',
    joinedAt: '9999-12-31T23:59:59.999Z',
  } as Entry
  const simulation = simulateAll(
    queue,
    state.lanes,
    [...waiting, candidate],
    inService,
    averageServiceTime(queue).milliseconds,
  ).get(candidate.id)

  return {
    lane: laneView(lane),
    eligible: true,
    available: acceptsEntries(queue) && !queueFull && !laneFull,
    queueFull,
    laneFull,
    lanePosition: simulation?.lanePosition ?? null,
    laneGroupsAhead: simulation?.laneGroupsAhead ?? null,
    globalWaitingGroupsAhead: simulation?.globalWaitingGroupsAhead ?? waiting.length,
    groupsInService: inService.length,
    estimatedWaitMinutes: simulation ? toMinutes(simulation.estimatedWaitMilliseconds) : null,
  }
}

// ------------------------------------------------------------------------------------- métricas

export function parseRange(value: string | undefined): MetricsRange {
  const range = value ?? 'TODAY'
  if (range !== 'TODAY' && range !== 'LAST_7_DAYS') {
    throw badRequest('INVALID_RANGE', 'range must be TODAY or LAST_7_DAYS')
  }
  return range
}

export const metricsView = (
  scope: { queueId?: string; name: string },
  range: MetricsRange,
  window: MetricsWindow,
  metrics: Metrics,
) => ({
  queueId: scope.queueId ?? null,
  scopeName: scope.name,
  range,
  from: window.from,
  to: window.to,
  ...metrics,
})

// ------------------------------------------------------------------------------------- historia

/** La versión Java guardaba el detalle como texto `clave=valor`; el frontend lo muestra así. */
function detailText(detail: DomainEvent['detail']): string | null {
  const parts = Object.entries(detail)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
  return parts.length > 0 ? parts.join(', ') : null
}

export const eventView = (event: DomainEvent) => ({
  id: event.id,
  queueId: event.queueId,
  entryId: event.entryId,
  type: event.type,
  actorType: event.actorType,
  actorId: event.actorId,
  detail: detailText(event.detail ?? {}),
  occurredAt: event.occurredAt,
})

export const notificationView = (record: NotificationRecord & { subject?: string }) => ({
  id: `${record.entryId}:${record.type}:${record.cycle}`,
  type: record.type,
  channel: record.channel,
  status: record.status,
  destination: record.destination,
  subject: record.subject ?? record.type,
  createdAt: record.createdAt,
  sentAt: record.sentAt,
})

// ------------------------------------------------------------------------------------- personas

export interface UserView {
  id: string
  email: string
  displayName: string
  createdAt: string
}

export const establishmentView = (establishment: Establishment, role?: MembershipRole) => ({
  id: establishment.id,
  name: establishment.name,
  timezone: establishment.timezone,
  role: role ?? null,
  createdAt: establishment.createdAt,
})

export const memberView = (membership: Membership) => ({
  membershipId: `${membership.establishmentId}:${membership.userId}`,
  userId: membership.userId,
  email: membership.email ?? '',
  displayName: membership.displayName ?? membership.email ?? '',
  role: membership.role,
  joinedAt: membership.createdAt,
})

/** Un tamaño de grupo que llega por query string. */
export function parsePartySize(value: string | undefined): number {
  const size = Number(value ?? '1')
  if (!Number.isInteger(size) || size < 1) {
    throw new HttpError(400, 'INVALID_PARTY_SIZE', 'partySize must be a positive integer')
  }
  return size
}
