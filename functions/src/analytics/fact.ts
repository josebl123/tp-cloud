// El hecho de una visita: una fila por cada persona que pasó por una fila, ya terminada.
//
// Es la tabla de hechos del data lake (la tabla `visitas` del catálogo de Glue). La operación vive en
// DynamoDB como estados que cambian; el análisis necesita lo contrario: un registro inmutable por
// visita, con todo lo que interesa ya calculado (cuánto esperó, cuánto se le estimó, cómo terminó, a
// qué hora local llegó), para que cualquier pregunta sea un GROUP BY.
//
// Sin AWS: lo arma el archiver a partir de la entrada, y la carga de demo a partir de visitas
// inventadas, con exactamente la misma forma.

import type { Entry, Establishment, Lane, Queue } from '../domain/types.js'
import { isTerminal } from '../domain/types.js'

/**
 * Los nombres y tipos de cada columna los define la tabla de Glue (terraform/organization/analytics.tf):
 * si cambia uno, cambia el otro. Los instantes van en milisegundos desde 1970, que es como Firehose los
 * convierte a timestamp de Parquet.
 */
export interface VisitFact {
  visit_id: string
  establishment_id: string
  establishment_name: string
  queue_id: string
  queue_name: string
  lane_id: string
  lane_name: string
  party_size: number
  /** Cómo terminó: SERVED (atendido), LEFT (se fue) o NO_SHOW (no se presentó). */
  outcome: string
  no_show_policy: string
  no_show_count: number
  joined_at: number
  called_at: number | null
  serving_started_at: number | null
  finished_at: number
  /** De anotarse a ser llamado. null si nunca lo llamaron (se fue antes). */
  wait_seconds: number | null
  /** De anotarse a terminar, pasara lo que pasara. */
  time_in_line_seconds: number
  /** De empezar a atenderlo a terminar. Solo para los atendidos. */
  service_seconds: number | null
  /** La espera que se le mostró al anotarse. null si no había con qué estimar. */
  estimated_wait_seconds: number | null
  /** Día y hora locales del local al llegar: lo que necesita un mapa de calor de demanda. */
  local_date: string
  local_hour: number
  /** 1 = lunes … 7 = domingo. */
  local_weekday: number
  /** La partición: el día local en que terminó la visita (AAAA-MM-DD). */
  dt: string
}

export interface VisitContext {
  establishment: Pick<Establishment, 'id' | 'name' | 'timezone'>
  queue: Pick<Queue, 'id' | 'name' | 'noShowPolicy'>
  lane: Pick<Lane, 'id' | 'name'> | null
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

// Crear un DateTimeFormat es caro; uno por zona horaria alcanza.
const formatters = new Map<string, Intl.DateTimeFormat>()
const formatterFor = (timezone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
    formatters.set(timezone, formatter)
  }
  return formatter
}

/** Las partes de un instante en una zona horaria, como texto: year, month, day, hour, minute, weekday. */
export function zonedParts(instant: string | number, timezone: string): Record<string, string> {
  return Object.fromEntries(formatterFor(timezone).formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
}

/** Fecha, hora y día de la semana de un instante, en la zona horaria del local. */
export function localParts(instant: string, timezone: string): { date: string; hour: number; weekday: number } {
  const parts = zonedParts(instant, timezone)
  return {
    date: `${parts['year']}-${parts['month']}-${parts['day']}`,
    hour: Number(parts['hour']),
    weekday: WEEKDAYS[parts['weekday'] ?? ''] ?? 0,
  }
}

const millis = (instant: string | null): number | null => (instant ? Date.parse(instant) : null)
const seconds = (from: string | null, to: string | null): number | null =>
  from && to ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000)) : null

/** El hecho de una visita terminada; null si todavía está en la fila (no hay nada que registrar). */
export function visitFact(entry: Entry, context: VisitContext): VisitFact | null {
  if (!isTerminal(entry.status) || !entry.finishedAt) return null
  const { timezone } = context.establishment
  const arrival = localParts(entry.joinedAt, timezone)
  const end = localParts(entry.finishedAt, timezone)

  return {
    visit_id: entry.id,
    establishment_id: context.establishment.id,
    establishment_name: context.establishment.name,
    queue_id: context.queue.id,
    queue_name: context.queue.name,
    lane_id: entry.laneId,
    lane_name: context.lane?.name ?? '',
    party_size: entry.partySize,
    outcome: entry.status,
    no_show_policy: context.queue.noShowPolicy,
    no_show_count: entry.noShowCount,
    joined_at: Date.parse(entry.joinedAt),
    called_at: millis(entry.calledAt),
    serving_started_at: millis(entry.servingStartedAt),
    finished_at: Date.parse(entry.finishedAt),
    wait_seconds: seconds(entry.joinedAt, entry.calledAt),
    time_in_line_seconds: seconds(entry.joinedAt, entry.finishedAt) ?? 0,
    service_seconds: entry.status === 'SERVED' ? seconds(entry.servingStartedAt ?? entry.calledAt, entry.finishedAt) : null,
    estimated_wait_seconds: entry.joinEstimateSeconds ?? null,
    local_date: arrival.date,
    local_hour: arrival.hour,
    local_weekday: arrival.weekday,
    dt: end.date,
  }
}
