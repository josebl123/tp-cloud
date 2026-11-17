// La capa de servicio de la analítica: los agregados diarios que calcula Athena, guardados en q-main
// para que el tablero los lea en milisegundos (analytics/aggregates.ts explica el porqué).
//
//   PK = ANALYTICS#<local>   SK = DAY#<AAAA-MM-DD>   queues = { <cola>: sumas, conteos, histogramas }
//
// Un local y un rango son una sola consulta por clave: a lo sumo 90 ítems chicos.

import { BatchWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { DailyAggregate } from '../analytics/aggregates.js'
import { figuresFrom } from '../analytics/aggregates.js'
import type { AnalyticsFigures, AnalyticsQuery, AnalyticsSource } from '../analytics/dashboard.js'
import type { TableConfig } from './client.js'
import * as keys from './keys.js'

/** El máximo de un BatchWriteItem. */
const BATCH_SIZE = 25
const BATCH_ATTEMPTS = 6

export class AnalyticsStore implements AnalyticsSource {
  constructor(
    private readonly table: TableConfig,
    private readonly pause: (milliseconds: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** Reemplaza los días calculados. Escribir el mismo día dos veces deja el mismo resultado. */
  async putDays(days: readonly DailyAggregate[], refreshedAt: Date): Promise<void> {
    const requests = days.map((day) => ({
      PutRequest: {
        Item: {
          PK: keys.analyticsPk(day.establishmentId),
          SK: keys.analyticsDaySk(day.date),
          kind: 'ANALYTICS_DAY',
          ...day,
          refreshedAt: refreshedAt.toISOString(),
        },
      },
    }))
    for (let start = 0; start < requests.length; start += BATCH_SIZE) {
      let pending = requests.slice(start, start + BATCH_SIZE)
      // DynamoDB puede aceptar el lote y devolver parte sin escribir: se reintenta solo esa parte.
      for (let attempt = 1; pending.length > 0; attempt++) {
        if (attempt > BATCH_ATTEMPTS) throw new Error(`Quedaron ${pending.length} días sin escribir`)
        const { UnprocessedItems } = await this.table.documents.send(
          new BatchWriteCommand({ RequestItems: { [this.table.tableName]: pending } }),
        )
        pending = (UnprocessedItems?.[this.table.tableName] ?? []) as typeof pending
        if (pending.length > 0) await this.pause(100 * 2 ** attempt)
      }
    }
  }

  async days(establishmentId: string, from: string, to: string): Promise<DailyAggregate[]> {
    const found: DailyAggregate[] = []
    let start: Record<string, unknown> | undefined
    do {
      const page = await this.table.documents.send(
        new QueryCommand({
          TableName: this.table.tableName,
          KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
          ExpressionAttributeValues: {
            ':pk': keys.analyticsPk(establishmentId),
            ':from': keys.analyticsDaySk(from),
            ':to': keys.analyticsDaySk(to),
          },
          ExclusiveStartKey: start,
        }),
      )
      for (const item of page.Items ?? []) {
        found.push({ establishmentId, date: String(item['date']), queues: item['queues'] as DailyAggregate['queues'] })
      }
      start = page.LastEvaluatedKey
    } while (start)
    return found
  }

  async figures(query: AnalyticsQuery): Promise<AnalyticsFigures> {
    return figuresFrom(await this.days(query.establishmentId, query.from, query.to), query.from, query.to)
  }
}
