// Las vistas que devuelve la API, con la misma forma que las de la versión Java: el frontend no
// tiene que enterarse de que cambió el backend.
//
// Todas salen de una sola simulación de la cola (`simulateAll`), así que el tablero y la vista de
// cada ticket cuestan lo mismo con una persona mirando que con cien.

import type { Simulation } from './estimation.js'
import { averageServiceTime, simulateAll, toMinutes } from './estimation.js'
import type { QueueState } from './state.js'
import { compareByOrder } from './ordering.js'
import type { Entry, EntryStatus, Lane, Queue } from './types.js'
import { IN_SERVICE_STATUSES } from './types.js'

export interface QueueSummary {
  id: string
  name: string
  description: string | null
  status: Queue['status']
  establishmentId: string
  establishmentName: string
}

export interface TicketView {
  ticketToken: string
  ticketNumber: number
  customerName: string
  partySize: number
  status: EntryStatus
  lanePosition: number | null
  laneGroupsAhead: number | null
  globalWaitingGroupsAhead: number | null
  groupsInService: number
  estimatedWaitMinutes: number | null
  noShowCount: number
  joinedAt: string
  calledAt: string | null
  finishedAt: string | null
  graceExpiresAt: string | null
  graceSecondsRemaining: number | null
  queue: QueueSummary
  ticketUrl: string
  laneId: string
  laneName: string | null
}

export interface EntryView {
  id: string
  ticketToken: string
  ticketNumber: number
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  partySize: number
  status: EntryStatus
  lanePosition: number | null
  laneGroupsAhead: number | null
  globalWaitingGroupsAhead: number | null
  groupsInService: number
  estimatedWaitMinutes: number | null
  noShowCount: number
  joinedAt: string
  calledAt: string | null
  servingStartedAt: string | null
  finishedAt: string | null
  graceExpiresAt: string | null
  graceSecondsRemaining: number | null
  laneId: string
  laneName: string | null
}

/** Todo lo que hace falta para armar cualquier vista de una cola, calculado una vez. */
export interface QueueSnapshot {
  queue: Queue
  lanes: Lane[]
  waiting: Entry[]
  inService: Entry[]
  simulations: Map<string, Simulation>
  averageServiceMinutes: number
  usingDefaultServiceTime: boolean
}

export function snapshot(state: QueueState): QueueSnapshot {
  const waiting = state.entries.filter((entry) => entry.status === 'WAITING').sort(compareByOrder)
  const inService = state.entries.filter((entry) => IN_SERVICE_STATUSES.includes(entry.status)).sort(compareByOrder)
  const average = averageServiceTime(state.queue)
  return {
    queue: state.queue,
    lanes: state.lanes,
    waiting,
    inService,
    simulations: simulateAll(state.queue, state.lanes, waiting, inService, average.milliseconds),
    averageServiceMinutes: toMinutes(average.milliseconds),
    usingDefaultServiceTime: average.usingDefault,
  }
}

const graceRemaining = (entry: Entry, now: Date): number | null => {
  if (entry.status !== 'CALLED' || entry.graceExpiresAt === null) return null
  return Math.max(0, Math.ceil((Date.parse(entry.graceExpiresAt) - now.getTime()) / 1000))
}

const laneName = (snap: QueueSnapshot, laneId: string): string | null =>
  snap.lanes.find((lane) => lane.id === laneId)?.name ?? null

function placement(snap: QueueSnapshot, entry: Entry) {
  const simulation = entry.status === 'WAITING' ? snap.simulations.get(entry.id) : undefined
  return {
    lanePosition: simulation?.lanePosition ?? null,
    laneGroupsAhead: simulation?.laneGroupsAhead ?? null,
    globalWaitingGroupsAhead: simulation?.globalWaitingGroupsAhead ?? null,
    groupsInService: snap.inService.length,
    estimatedWaitMinutes: simulation ? toMinutes(simulation.estimatedWaitMilliseconds) : null,
  }
}

export function entryView(snap: QueueSnapshot, entry: Entry, now: Date): EntryView {
  return {
    id: entry.id,
    ticketToken: entry.ticketToken,
    ticketNumber: entry.ticketNumber,
    customerName: entry.customerName,
    customerEmail: entry.customerEmail,
    customerPhone: entry.customerPhone,
    partySize: entry.partySize,
    status: entry.status,
    ...placement(snap, entry),
    noShowCount: entry.noShowCount,
    joinedAt: entry.joinedAt,
    calledAt: entry.calledAt,
    servingStartedAt: entry.servingStartedAt,
    finishedAt: entry.finishedAt,
    graceExpiresAt: entry.graceExpiresAt,
    graceSecondsRemaining: graceRemaining(entry, now),
    laneId: entry.laneId,
    laneName: laneName(snap, entry.laneId),
  }
}

/** Lo que ve un cliente de su propio lugar: nunca datos de otras personas. */
export function ticketView(
  snap: QueueSnapshot,
  entry: Entry,
  summary: QueueSummary,
  ticketUrl: string,
  now: Date,
): TicketView {
  return {
    ticketToken: entry.ticketToken,
    ticketNumber: entry.ticketNumber,
    customerName: entry.customerName,
    partySize: entry.partySize,
    status: entry.status,
    ...placement(snap, entry),
    noShowCount: entry.noShowCount,
    joinedAt: entry.joinedAt,
    calledAt: entry.calledAt,
    finishedAt: entry.finishedAt,
    graceExpiresAt: entry.graceExpiresAt,
    graceSecondsRemaining: graceRemaining(entry, now),
    queue: summary,
    ticketUrl,
    laneId: entry.laneId,
    laneName: laneName(snap, entry.laneId),
  }
}
