// El tablero de análisis del panel: lo que el negocio mira para decidir (cuándo se llena, cuánto
// espera la gente, cuánto le erramos a la estimación, cuánta se va), sobre meses de visitas.
//
// Las métricas del panel (domain/metrics.ts) son operativas: hoy y los últimos 7 días, leídos de
// DynamoDB. Esto es histórico y sale de la tabla de hechos del data lake (analytics/fact.ts). La forma
// del tablero no depende del motor que lo calcule: la ruta le pide los números a una `AnalyticsSource`.

import { badRequest } from '../http/api.js'
import { localParts } from './fact.js'

export const ANALYTICS_RANGES = { LAST_30_DAYS: 30, LAST_90_DAYS: 90 } as const
export type AnalyticsRange = keyof typeof ANALYTICS_RANGES

/** Los indicadores de un conjunto de visitas. Los promedios faltan si no hubo con qué calcularlos. */
export interface AnalyticsSummary {
  visits: number
  served: number
  left: number
  noShows: number
  averageWaitMinutes: number | null
  /** El 90 % de los llamados esperó esto o menos: lo que vive el cliente de un día malo. */
  p90WaitMinutes: number | null
  averageServiceMinutes: number | null
  averagePartySize: number | null
  /** Promedio de |estimada − real| entre los que fueron llamados y tenían estimación. */
  estimateErrorMinutes: number | null
  /** Proporción de esas visitas en que la estimación erró por 5 minutos o menos. */
  estimateHitRate: number | null
  /** Se fueron por su cuenta, sobre el total. */
  abandonmentRate: number
  noShowRate: number
}

export interface AnalyticsDay {
  /** Día local, AAAA-MM-DD. */
  date: string
  visits: number
  served: number
  averageWaitMinutes: number | null
}

/** Llegadas por día de la semana (1 = lunes … 7 = domingo) y hora local, sumadas en el rango. */
export interface AnalyticsHeatCell {
  weekday: number
  hour: number
  visits: number
}

export interface AnalyticsQueue extends AnalyticsSummary {
  queueId: string
  name: string
}

/** Lo que calcula el motor analítico para un establecimiento y un rango de días locales. */
export interface AnalyticsFigures {
  summary: AnalyticsSummary
  /** Un elemento por día del rango, también los días sin visitas. */
  daily: AnalyticsDay[]
  heatmap: AnalyticsHeatCell[]
  queues: AnalyticsQueue[]
  /** El fin de la visita más reciente que ya está en el lake. */
  dataUntil: string | null
}

export interface AnalyticsDashboard extends AnalyticsFigures {
  establishmentId: string
  establishmentName: string
  timezone: string
  range: AnalyticsRange
  from: string
  to: string
}

export interface AnalyticsQuery {
  establishmentId: string
  /** Primer y último día local, incluidos (AAAA-MM-DD). */
  from: string
  to: string
}

/** El motor analítico, sea cual sea. La ruta solo conoce esto. */
export interface AnalyticsSource {
  figures(query: AnalyticsQuery): Promise<AnalyticsFigures>
}

export function parseAnalyticsRange(value: string | undefined): AnalyticsRange {
  const range = value ?? 'LAST_30_DAYS'
  if (!(range in ANALYTICS_RANGES)) throw badRequest('INVALID_RANGE', 'range must be LAST_30_DAYS or LAST_90_DAYS')
  return range as AnalyticsRange
}

/** Suma días a una fecha AAAA-MM-DD, sin pasar por ninguna zona horaria. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** Los días del rango, terminando hoy en la zona horaria del local. */
export function analyticsWindow(range: AnalyticsRange, timezone: string, now: Date): { from: string; to: string } {
  const today = localParts(now.toISOString(), timezone).date
  return { from: addDays(today, -(ANALYTICS_RANGES[range] - 1)), to: today }
}
