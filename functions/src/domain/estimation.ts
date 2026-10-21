// La espera que se le muestra a cada cliente.
//
// Se simulan los puestos de atención compartidos: cada puesto queda libre cuando termina lo que está
// atendiendo, y la fila se reparte en el orden en que el selector la va a llamar. La duración de cada
// servicio es el promedio reciente de la cola multiplicado por el factor de tiempo del carril.

import { select, rotation } from './selector.js'
import type { Entry, Lane, Queue } from './types.js'

/** Cuántos servicios recientes se promedian. Es lo que guarda `Queue.recentServiceSeconds`. */
export const SERVICE_TIME_SAMPLES = 10

export interface ServiceTimeEstimate {
  milliseconds: number
  /** Sin historial: se usa el valor configurado en la cola, y la interfaz lo puede decir. */
  usingDefault: boolean
  sampleCount: number
}

export interface Simulation {
  /** Lugar dentro de su carril, desde 1. */
  lanePosition: number
  laneGroupsAhead: number
  /** Grupos que se van a llamar antes, en toda la cola. */
  globalWaitingGroupsAhead: number
  groupsInService: number
  /** Desde ahora hasta que empieza su servicio. */
  estimatedWaitMilliseconds: number
}

/** Agrega una duración al historial de la cola y conserva solo las últimas muestras. */
export function recordServiceTime(recent: readonly number[], seconds: number): number[] {
  if (!(seconds > 0)) return [...recent]
  return [...recent, Math.round(seconds)].slice(-SERVICE_TIME_SAMPLES)
}

export function averageServiceTime(queue: Queue): ServiceTimeEstimate {
  const samples = queue.recentServiceSeconds.filter((seconds) => seconds > 0).slice(-SERVICE_TIME_SAMPLES)
  const fallback: ServiceTimeEstimate = {
    milliseconds: queue.defaultServiceMinutes * 60_000,
    usingDefault: true,
    sampleCount: 0,
  }
  if (samples.length === 0) return fallback
  const averageSeconds = Math.floor(samples.reduce((sum, value) => sum + value, 0) / samples.length)
  if (averageSeconds <= 0) return fallback
  return { milliseconds: averageSeconds * 1000, usingDefault: false, sampleCount: samples.length }
}

/** Redondea para arriba a minutos enteros, que es como se muestra la espera. */
export function toMinutes(milliseconds: number | null | undefined): number {
  if (milliseconds === null || milliseconds === undefined || milliseconds <= 0) return 0
  return Math.ceil(Math.floor(milliseconds / 1000) / 60)
}

/** Una cola de prioridad mínima chica: hay tan pocos puestos que ordenar alcanza. */
class Stations {
  private readonly freeAt: number[]

  constructor(count: number) {
    this.freeAt = Array.from({ length: Math.max(1, count) }, () => 0)
  }

  /** Saca el puesto que se libera primero y devuelve cuándo. */
  take(): number {
    this.freeAt.sort((a, b) => a - b)
    return this.freeAt.shift() as number
  }

  put(at: number): void {
    this.freeAt.push(at)
  }
}

function adjusted(base: number, entry: Entry, lanesById: ReadonlyMap<string, Lane>): number {
  const factor = lanesById.get(entry.laneId)?.timeFactor ?? 1
  return Math.max(1, Math.round(base * factor))
}

/**
 * La simulación de toda la fila en una sola pasada, por id de entrada.
 *
 * Programar ya recorre a cada grupo en el orden en que se lo va a atender, así que una pasada
 * responde por todos. Es lo que mantiene barato un push: cien personas mirando cuestan una
 * simulación, no cien.
 *
 * @param waiting   la fila, en orden de clave
 * @param inService los llamados y los que se están atendiendo
 */
export function simulateAll(
  queue: Queue,
  lanes: readonly Lane[],
  waiting: readonly Entry[],
  inService: readonly Entry[],
  averageMilliseconds: number,
): Map<string, Simulation> {
  const lanesById = new Map(lanes.map((lane) => [lane.id, lane]))

  // El lugar en el carril sigue la clave de orden, que es como se presenta la fila, y no el orden en
  // que la estrategia de llamado programa.
  const laneAhead = new Map<string, number>()
  const seenPerLane = new Map<string, number>()
  for (const entry of waiting) {
    const ahead = seenPerLane.get(entry.laneId) ?? 0
    laneAhead.set(entry.id, ahead)
    seenPerLane.set(entry.laneId, ahead + 1)
  }

  const stations = new Stations(queue.serviceStations)
  for (const entry of inService) stations.put(stations.take() + adjusted(averageMilliseconds, entry, lanesById))

  const simulations = new Map<string, Simulation>()
  const rotationLanes = rotation(lanes)
  let remaining = [...waiting]
  let cursor = queue.roundRobinPosition
  let scheduledAhead = 0
  while (remaining.length > 0) {
    const selection = select(queue.callStrategy, lanes, rotationLanes, remaining, cursor)
    cursor = selection.nextRoundRobinPosition
    const entry = selection.entry
    const start = stations.take()
    const ahead = laneAhead.get(entry.id) ?? 0
    simulations.set(entry.id, {
      lanePosition: ahead + 1,
      laneGroupsAhead: ahead,
      globalWaitingGroupsAhead: scheduledAhead,
      groupsInService: inService.length,
      estimatedWaitMilliseconds: start,
    })
    stations.put(start + adjusted(averageMilliseconds, entry, lanesById))
    remaining = remaining.filter((candidate) => candidate.id !== entry.id)
    scheduledAhead++
  }
  return simulations
}
