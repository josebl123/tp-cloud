// Carriles: una cola con un solo QR, segmentada por tamaño de grupo.

import { conflict, validation } from './errors.js'
import type { Entry, Lane } from './types.js'
import { isActive } from './types.js'

const upper = (lane: Lane): number => lane.maxPartySize ?? Number.MAX_SAFE_INTEGER

export const isLive = (lane: Lane): boolean => lane.deletedAt === null

export const accepts = (lane: Lane, partySize: number): boolean =>
  lane.active && isLive(lane) && partySize >= lane.minPartySize && partySize <= upper(lane)

/**
 * El carril que recibe a un grupo. Entre rangos anidados gana el más interno: es la regla más
 * específica para ese tamaño. La prioridad de llamado no interviene en esta elección.
 */
export function selectLane(lanes: readonly Lane[], partySize: number): Lane {
  const matches = lanes
    .filter((lane) => accepts(lane, partySize))
    .sort((a, b) => b.minPartySize - a.minPartySize || upper(a) - upper(b))
  const chosen = matches[0]
  if (!chosen) {
    throw conflict('NO_COMPATIBLE_LANE', `No active lane accepts a party of ${partySize}`)
  }
  return chosen
}

/** Rechaza el ingreso si el carril ya está lleno, contando personas o grupos según su modo. */
export function ensureLaneCapacity(lane: Lane, entries: readonly Entry[], partySize: number): void {
  if (lane.maxSize === null) return
  const units = (size: number) => (lane.capacityMode === 'PERSONS' ? size : 1)
  const used = entries
    .filter((entry) => entry.laneId === lane.id && isActive(entry.status))
    .reduce((sum, entry) => sum + units(entry.partySize), 0)
  if (used + units(partySize) > lane.maxSize) {
    throw conflict('LANE_FULL', `Lane '${lane.name}' has reached its capacity`)
  }
}

const isWhole = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max

export function validateLane(lane: Lane): void {
  if (!lane.name || lane.name.length > 120) throw validation('INVALID_LANE_NAME', 'A lane name has 1 to 120 characters')
  if (
    !isWhole(lane.minPartySize, 1, 1000) ||
    (lane.maxPartySize !== null && !isWhole(lane.maxPartySize, lane.minPartySize, 1000))
  ) {
    throw validation('INVALID_LANE_RANGE', 'Lane party-size range is invalid')
  }
  if (lane.maxSize !== null && !isWhole(lane.maxSize, 1, 10_000)) {
    throw validation('INVALID_LANE_CAPACITY', 'Lane capacity must be positive')
  }
  if (!isWhole(lane.priority, 0, 1000) || !(lane.timeFactor >= 0.1 && lane.timeFactor <= 10)) {
    throw validation('INVALID_LANE_CONFIGURATION', 'Lane priority and time factor are invalid')
  }
}

const intersects = (a: Lane, b: Lane) => a.minPartySize <= upper(b) && b.minPartySize <= upper(a)
const contains = (outer: Lane, inner: Lane) =>
  outer.minPartySize <= inner.minPartySize && upper(outer) >= upper(inner)

/** Los rangos activos pueden ser disjuntos o anidados, pero no cruzarse a medias. */
export function validateOverlap(lanes: readonly Lane[], candidate: Lane): void {
  if (!candidate.active) return
  for (const other of lanes) {
    if (other.id === candidate.id || !isLive(other) || !other.active) continue
    if (intersects(candidate, other) && !contains(candidate, other) && !contains(other, candidate)) {
      throw validation(
        'CROSSING_LANE_RANGES',
        'Active lane ranges may be disjoint or nested, but cannot partially overlap',
      )
    }
  }
}

/** Una cola tiene que conservar al menos un carril activo. */
export function requireAnotherActiveLane(lanes: readonly Lane[], excludedId: string): void {
  const others = lanes.filter((lane) => isLive(lane) && lane.active && lane.id !== excludedId)
  if (others.length === 0) {
    throw conflict('LAST_ACTIVE_LANE', 'A queue must keep at least one active lane')
  }
}

export function requireNameFree(lanes: readonly Lane[], name: string, excludedId: string | null): void {
  if (lanes.some((lane) => isLive(lane) && lane.name === name && lane.id !== excludedId)) {
    throw conflict('LANE_NAME_TAKEN', `Another lane in this queue is already called '${name}'`)
  }
}

/** El orden estable de los carriles: prioridad y después id. */
export function compareLanes(a: Lane, b: Lane): number {
  return a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
