// El historial de demo: meses de visitas inventadas para que el tablero de análisis tenga algo que
// mostrar el día que se despliega. Solo para los datos de demo; la operación real carga el lake
// visita por visita (λ archiver).
//
// Cada visita se arma como una entrada terminada y pasa por `visitFact`, la misma función que usa el
// archiver: el historial tiene exactamente la forma de los hechos reales. Es determinista (cada día
// de cada cola sale de su propia semilla) y los ids dependen de la cola, el día y el número de
// visita: cargarlo dos veces el mismo día produce los mismos ids, que las consultas cuentan una vez.

import { addDays } from './dashboard.js'
import type { VisitFact } from './fact.js'
import { localParts, visitFact, zonedParts } from './fact.js'
import { DEFAULT_LANE_NAME } from '../domain/queues.js'
import type { Entry, EntryStatus, NoShowPolicy } from '../domain/types.js'

export interface HistoryQueue {
  id: string
  defaultLaneId: string
  settings: { name: string; serviceStations?: number; defaultServiceMinutes?: number; noShowPolicy?: NoShowPolicy }
  lanes?: { id: string; name: string; minPartySize: number; maxPartySize: number | null }[]
}

export interface HistoryInput {
  establishment: { id: string; name: string; timezone: string }
  queues: HistoryQueue[]
  /** Cuántos días hacia atrás, terminando ayer. */
  days: number
}

/** Un generador pseudoaleatorio chico y determinista (mulberry32). */
function random(seedText: string): () => number {
  let seed = 0
  for (const char of seedText) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) | 0
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cuánta gente llega en cada hora local, relativo al pico: almuerzo y cena. */
const ARRIVALS_BY_HOUR: Record<number, number> = {
  12: 0.5, 13: 1, 14: 0.8, 15: 0.3,
  19: 0.2, 20: 0.6, 21: 1, 22: 0.9, 23: 0.4,
}
/** Más gente el fin de semana. 1 = lunes … 7 = domingo. */
const WEEKDAY_FACTOR = [0, 0.6, 0.65, 0.75, 0.85, 1.25, 1.45, 1.1]

/** El instante UTC de una hora local del local: se prueba como si fuera UTC y se corrige el desfase. */
function instantAt(date: string, minuteOfDay: number, timezone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const guess = Date.UTC(year, month - 1, day, 0, minuteOfDay)
  const parts = Object.fromEntries(Object.entries(zonedParts(guess, timezone)).map(([key, value]) => [key, Number(value)]))
  const shown = Date.UTC(parts['year'] ?? year, (parts['month'] ?? month) - 1, parts['day'] ?? day, parts['hour'] ?? 0, parts['minute'] ?? 0)
  return guess - (shown - guess)
}

function partySizeFor(next: () => number, single: boolean): number {
  if (single) return next() < 0.7 ? 1 : 2
  const roll = next()
  if (roll < 0.25) return 1
  if (roll < 0.6) return 2
  if (roll < 0.75) return 3
  if (roll < 0.9) return 4
  return 5 + Math.floor(next() * 3)
}

/** Las visitas de una cola en un día local. */
function dayOfQueue(input: HistoryInput, queue: HistoryQueue, date: string, growth: number): VisitFact[] {
  const next = random(`${queue.id}:${date}`)
  const { timezone } = input.establishment
  const weekday = localParts(new Date(instantAt(date, 12 * 60, timezone)).toISOString(), timezone).weekday
  const lanes = queue.lanes?.length ? queue.lanes : [{ id: queue.defaultLaneId, name: DEFAULT_LANE_NAME, minPartySize: 1, maxPartySize: null }]
  const single = lanes.length === 1
  const serviceMinutes = queue.settings.defaultServiceMinutes ?? 10
  const stations = queue.settings.serviceStations ?? 1
  const policy = queue.settings.noShowPolicy ?? 'MOVE_TO_END'
  const peakPerHour = (single ? 14 : 22) * (WEEKDAY_FACTOR[weekday] ?? 1) * growth

  const facts: VisitFact[] = []
  let n = 0
  for (const [hourText, share] of Object.entries(ARRIVALS_BY_HOUR)) {
    const hour = Number(hourText)
    const arrivals = Math.round(peakPerHour * share * (0.8 + next() * 0.4))
    // La espera crece con la carga de esa hora respecto de lo que se puede atender.
    const load = (peakPerHour * share * serviceMinutes) / (60 * stations)
    for (let i = 0; i < arrivals; i++) {
      n++
      const joinedAt = instantAt(date, hour * 60 + Math.floor(next() * 60), timezone)
      const waitMinutes = Math.max(0, load * 12 * (0.4 + next() * 1.2) + next() * 4)
      const estimateMinutes = waitMinutes * (0.75 + next() * 0.5) + (next() - 0.5) * 4
      const partySize = partySizeFor(next, single)
      const lane =
        lanes.find((candidate) => partySize >= candidate.minPartySize && (candidate.maxPartySize === null || partySize <= candidate.maxPartySize)) ??
        lanes[0]!

      // Se va más gente cuanto más larga la espera; algunos no se presentan al ser llamados.
      const roll = next()
      const leaves = roll < Math.min(0.25, 0.03 + waitMinutes / 300)
      const noShow = !leaves && roll > 0.95
      const status: EntryStatus = leaves ? 'LEFT' : noShow ? 'NO_SHOW' : 'SERVED'

      const calledAt = leaves ? null : joinedAt + waitMinutes * 60000
      const servingStartedAt = status === 'SERVED' && calledAt !== null ? calledAt + (1 + next() * 3) * 60000 : null
      const finishedAt =
        status === 'LEFT'
          ? joinedAt + waitMinutes * (0.3 + next() * 0.6) * 60000
          : status === 'NO_SHOW'
            ? (calledAt as number) + 5 * 60000
            : (servingStartedAt as number) + serviceMinutes * (0.6 + next() * 0.9) * 60000

      const iso = (millis: number | null) => (millis === null ? null : new Date(Math.round(millis)).toISOString())
      const entry: Entry = {
        id: `hist-${queue.id}-${date}-${String(n).padStart(4, '0')}`,
        queueId: queue.id,
        laneId: lane.id,
        ticketToken: '',
        ticketNumber: n,
        customerName: '',
        customerEmail: null,
        customerPhone: null,
        partySize,
        locale: 'es',
        status,
        orderKey: '',
        notificationCycle: 0,
        noShowCount: noShow ? 1 : 0,
        joinedAt: iso(joinedAt) as string,
        calledAt: iso(calledAt),
        servingStartedAt: iso(servingStartedAt),
        finishedAt: iso(finishedAt),
        graceExpiresAt: null,
        joinEstimateSeconds: Math.max(0, Math.round(estimateMinutes * 60)),
      }
      const fact = visitFact(entry, {
        establishment: input.establishment,
        queue: { id: queue.id, name: queue.settings.name, noShowPolicy: policy },
        lane,
      })
      if (fact) facts.push(fact)
    }
  }
  return facts
}

/** Las visitas inventadas de los últimos `days` días, terminando ayer en la zona horaria del local. */
export function historicalFacts(input: HistoryInput, now: Date): VisitFact[] {
  const today = localParts(now.toISOString(), input.establishment.timezone).date
  const facts: VisitFact[] = []
  for (let back = input.days; back >= 1; back--) {
    // Un local que crece: el primer día del historial tiene un 25 % menos de gente que ayer.
    const growth = 1 - (0.25 * (back - 1)) / Math.max(1, input.days)
    const date = addDays(today, -back)
    for (const queue of input.queues) facts.push(...dayOfQueue(input, queue, date, growth))
  }
  return facts
}
