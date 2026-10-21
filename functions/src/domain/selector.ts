// A quién se llama después. Determinista y sin efectos: lo usan tanto el llamado real como la
// simulación de la espera, así que la demora que se le anuncia a un cliente sale de las mismas
// reglas que lo van a atender.
//
// El round robin rota sobre todos los carriles activos de la cola, no sobre los que tienen gente.
// El cursor es un índice que se guarda entre llamados: si indexara una lista que cambia de largo,
// significaría otra cosa cada vez, y se saltearía justo el carril que la rotación tiene que proteger.

import { isLive, compareLanes } from './lanes.js'
import { compareByOrder } from './ordering.js'
import type { CallStrategy, Entry, Lane } from './types.js'

export interface Selection {
  entry: Entry
  nextRoundRobinPosition: number
}

/** Los carriles sobre los que rota un round robin: todos los activos, en orden estable. */
export function rotation(lanes: readonly Lane[]): Lane[] {
  return lanes.filter((lane) => isLive(lane) && lane.active).sort(compareLanes)
}

const oldest = (entries: readonly Entry[]): Entry | undefined => [...entries].sort(compareByOrder)[0]

/**
 * @param lanes    todos los carriles de la cola, incluso los retirados: la prioridad de una entrada
 *                 se lee de su carril aunque ya no reciba gente
 * @param rotationLanes el resultado de `rotation`; solo lo lee ROUND_ROBIN
 */
export function select(
  strategy: CallStrategy,
  lanes: readonly Lane[],
  rotationLanes: readonly Lane[],
  waiting: readonly Entry[],
  roundRobinPosition: number,
): Selection {
  if (waiting.length === 0) throw new RangeError('waiting must not be empty')

  if (strategy === 'LANE_PRIORITY') {
    const priority = new Map(lanes.map((lane) => [lane.id, lane.priority]))
    const next = [...waiting].sort(
      (a, b) =>
        (priority.get(a.laneId) ?? Number.MAX_SAFE_INTEGER) - (priority.get(b.laneId) ?? Number.MAX_SAFE_INTEGER) ||
        compareByOrder(a, b),
    )[0]
    return { entry: next as Entry, nextRoundRobinPosition: roundRobinPosition }
  }

  if (strategy === 'ROUND_ROBIN' && rotationLanes.length > 0) {
    const size = rotationLanes.length
    const start = ((roundRobinPosition % size) + size) % size
    for (let offset = 0; offset < size; offset++) {
      const laneIndex = (start + offset) % size
      const lane = rotationLanes[laneIndex] as Lane
      const next = oldest(waiting.filter((entry) => entry.laneId === lane.id))
      if (next) return { entry: next, nextRoundRobinPosition: (laneIndex + 1) % size }
    }
  }

  // GLOBAL_AGE, o un round robin sin ningún carril activo con gente: el grupo que más espera.
  return { entry: oldest(waiting) as Entry, nextRoundRobinPosition: roundRobinPosition }
}
