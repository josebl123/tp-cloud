// Los números del panel del staff.
//
// Los rangos se anclan al día calendario del establecimiento y no a UTC, así "hoy" significa lo que
// entiende quien está detrás del mostrador. Las entradas terminadas se leen por rango de fecha (su
// clave de ordenamiento empieza con la hora de fin), así que no hace falta ningún agregado previo.

import { toMinutes } from './estimation.js'
import type { Entry } from './types.js'

export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'

export interface MetricsWindow {
  /** Inicio del primer día local, incluido. */
  from: string
  /** Inicio de mañana, excluido. */
  to: string
}

export interface Metrics {
  waitingNow: number
  inServiceNow: number
  servedCount: number
  noShowCount: number
  leftCount: number
  finishedCount: number
  averageWaitMinutes: number | null
  averageServiceMinutes: number | null
  /** Proporción de terminadas en las que el cliente se fue por su cuenta. */
  abandonmentRate: number
  noShowRate: number
}

/** Desplazamiento de una zona horaria respecto de UTC en un instante, en milisegundos. */
function offsetMs(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

function resolveZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return DEFAULT_TIMEZONE
  }
}

/** El instante UTC de la medianoche local del día que contiene `instant`, corrido `dayShift` días. */
function localMidnight(timeZone: string, instant: Date, dayShift: number): Date {
  const local = new Date(instant.getTime() + offsetMs(timeZone, instant))
  const midnightAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayShift)
  // El desplazamiento se vuelve a calcular en el instante resultante: un cambio de horario entre
  // medio no corre el borde una hora.
  const guess = new Date(midnightAsUtc - offsetMs(timeZone, new Date(midnightAsUtc)))
  return new Date(midnightAsUtc - offsetMs(timeZone, guess))
}

/** El intervalo [inicio del primer día local, inicio de mañana) de los últimos `days` días. */
export function windowFor(timezone: string, days: number, now: Date): MetricsWindow {
  const zone = resolveZone(timezone)
  return {
    from: localMidnight(zone, now, -(Math.max(1, days) - 1)).toISOString(),
    to: localMidnight(zone, now, 1).toISOString(),
  }
}

const seconds = (from: string | null, to: string | null): number | null =>
  from && to ? (Date.parse(to) - Date.parse(from)) / 1000 : null

function averageMinutes(values: (number | null)[]): number | null {
  const measured = values.filter((value): value is number => value !== null && value >= 0)
  if (measured.length === 0) return null
  const average = Math.floor(measured.reduce((sum, value) => sum + value, 0) / measured.length)
  return toMinutes(average * 1000)
}

const ratio = (part: number, total: number): number => (total === 0 ? 0 : Math.round((part / total) * 10_000) / 10_000)

/**
 * @param finished las entradas terminadas dentro de la ventana
 * @param active   las activas de ahora, para los contadores en vivo
 */
export function computeMetrics(finished: readonly Entry[], active: readonly Entry[]): Metrics {
  const served = finished.filter((entry) => entry.status === 'SERVED')
  const noShow = finished.filter((entry) => entry.status === 'NO_SHOW').length
  const left = finished.filter((entry) => entry.status === 'LEFT').length
  return {
    waitingNow: active.filter((entry) => entry.status === 'WAITING').length,
    inServiceNow: active.filter((entry) => entry.status === 'CALLED' || entry.status === 'SERVING').length,
    servedCount: served.length,
    noShowCount: noShow,
    leftCount: left,
    finishedCount: finished.length,
    averageWaitMinutes: averageMinutes(served.map((entry) => seconds(entry.joinedAt, entry.calledAt))),
    averageServiceMinutes: averageMinutes(served.map((entry) => seconds(entry.servingStartedAt, entry.finishedAt))),
    abandonmentRate: ratio(left, finished.length),
    noShowRate: ratio(noShow, finished.length),
  }
}
