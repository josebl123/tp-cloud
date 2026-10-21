// Qué avisos corresponden, decidido sobre el estado actual de la cola.
//
// No se decide dentro de la transacción del staff (como hacía la versión Java) porque un solo
// movimiento puede hacer cruzar un umbral a decenas de personas, y eso no entra en una transacción.
// `λ notifier` llama a esta función después de cada evento: como mira el estado y no el evento, le da
// igual el orden o los duplicados, y la escritura condicional de `NOTIF#type#cycle` evita el segundo
// envío.

import type { Simulation } from './estimation.js'
import { toMinutes } from './estimation.js'
import type { DomainEvent, Entry, NotificationType, Queue } from './types.js'

export interface DueNotification {
  entry: Entry
  type: NotificationType
  cycle: number
  /** Datos para armar el texto en el idioma de la entrada. */
  groupsAhead: number | null
  estimatedMinutes: number | null
  newPosition: number | null
}

/** Avisos de proximidad para todos los que esperan. */
export function dueThresholds(
  queue: Queue,
  waiting: readonly Entry[],
  simulations: ReadonlyMap<string, Simulation>,
): DueNotification[] {
  const position = queue.notifyAtPosition
  const minutes = queue.notifyAtMinutes
  if (position === null && minutes === null) return []

  const due: DueNotification[] = []
  for (const entry of waiting) {
    const simulation = simulations.get(entry.id)
    if (!simulation) continue
    const groupsAhead = simulation.globalWaitingGroupsAhead
    const estimatedMinutes = toMinutes(simulation.estimatedWaitMilliseconds)
    const base = { entry, cycle: entry.notificationCycle, groupsAhead, estimatedMinutes, newPosition: null }
    if (position !== null && groupsAhead <= position) due.push({ ...base, type: 'APPROACHING_POSITION' })
    if (minutes !== null && estimatedMinutes <= minutes) due.push({ ...base, type: 'APPROACHING_TIME' })
  }
  return due
}

/** El aviso que dispara un evento puntual, si dispara alguno. */
export function dueForEvent(
  event: DomainEvent,
  entry: Entry,
  simulation: Simulation | undefined,
): DueNotification | null {
  const cycle = event.cycle ?? entry.notificationCycle
  const base = {
    entry,
    cycle,
    groupsAhead: simulation?.globalWaitingGroupsAhead ?? null,
    estimatedMinutes: simulation ? toMinutes(simulation.estimatedWaitMilliseconds) : null,
    newPosition: null,
  }
  switch (event.type) {
    case 'ENTRY_JOINED':
      return { ...base, type: 'TICKET_CREATED' }
    case 'ENTRY_CALLED':
      return { ...base, type: 'YOUR_TURN' }
    case 'ENTRY_NO_SHOW': {
      const newPosition = event.detail['newPosition']
      return { ...base, type: 'NO_SHOW', newPosition: typeof newPosition === 'number' ? newPosition : null }
    }
    case 'ENTRY_LEFT':
      return event.detail['reason'] === 'QUEUE_CLOSED' ? { ...base, type: 'QUEUE_CLOSED' } : null
    default:
      return null
  }
}
