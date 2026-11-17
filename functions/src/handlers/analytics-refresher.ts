// λ analytics-refresher: cada tanto (EventBridge Scheduler) recalcula con Athena los agregados
// diarios de los últimos días y los deja en DynamoDB, que es de donde lee el tablero.
//
// Recalcula la ventana entera en cada vuelta en lugar de sumar lo nuevo: no hay estado incremental
// que se pueda desfasar, un hecho que llegó tarde o repetido se corrige solo en la vuelta siguiente,
// y dos ejecuciones superpuestas escriben lo mismo. Lo que escanea está acotado por la ventana: con
// el lake particionado por día, Athena abre solo esas carpetas, y por ser Parquet, solo las columnas
// que usa la consulta.

import { AthenaClient, GetQueryExecutionCommand, GetQueryResultsCommand, StartQueryExecutionCommand } from '@aws-sdk/client-athena'
import type { GetQueryExecutionCommandOutput, GetQueryResultsCommandOutput } from '@aws-sdk/client-athena'
import { aggregatesQuery, parseRows } from '../analytics/aggregates.js'
import type { DailyAggregate } from '../analytics/aggregates.js'
import { addDays } from '../analytics/dashboard.js'
import { required } from '../consumers/sqs.js'
import { AnalyticsStore } from '../persistence/analytics-store.js'
import { createTableConfig } from '../persistence/client.js'

type AthenaCommand = StartQueryExecutionCommand | GetQueryExecutionCommand | GetQueryResultsCommand

export interface RefresherDependencies {
  athena: { send(command: AthenaCommand): Promise<unknown> }
  store: { putDays(days: readonly DailyAggregate[], refreshedAt: Date): Promise<void> }
  workgroup: string
  database: string
  table: string
  /** Cuántos días hacia atrás se recalculan: los del rango más largo del tablero. */
  windowDays: number
  now?: () => Date
  pause?: (milliseconds: number) => Promise<void>
}

const POLL_MILLISECONDS = 1000
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export interface RefreshResult {
  queryExecutionId: string
  since: string
  days: number
  /** Lo que escaneó Athena: lo que se paga. */
  bytesScanned: number
}

export async function refresh(deps: RefresherDependencies, deadline: () => number = () => Infinity): Promise<RefreshResult> {
  const now = deps.now?.() ?? new Date()
  const pause = deps.pause ?? sleep
  // Un día de margen: el día local de un local al oeste de UTC puede ser el anterior al de UTC.
  const since = addDays(now.toISOString().slice(0, 10), -deps.windowDays)

  const started = (await deps.athena.send(
    new StartQueryExecutionCommand({
      QueryString: aggregatesQuery(deps.database, deps.table, since),
      WorkGroup: deps.workgroup,
      QueryExecutionContext: { Database: deps.database },
    }),
  )) as { QueryExecutionId?: string }
  const queryExecutionId = started.QueryExecutionId
  if (!queryExecutionId) throw new Error('Athena no devolvió el id de la consulta')

  // Athena es asíncrona: se arranca la consulta y se pregunta hasta que termina.
  let execution: GetQueryExecutionCommandOutput['QueryExecution']
  for (;;) {
    const result = (await deps.athena.send(new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }))) as GetQueryExecutionCommandOutput
    execution = result.QueryExecution
    const state = execution?.Status?.State
    if (state === 'SUCCEEDED') break
    if (state === 'FAILED' || state === 'CANCELLED') {
      throw new Error(`La consulta ${queryExecutionId} terminó ${state}: ${execution?.Status?.StateChangeReason ?? ''}`)
    }
    if (deadline() < POLL_MILLISECONDS * 3) throw new Error(`La consulta ${queryExecutionId} no terminó a tiempo`)
    await pause(POLL_MILLISECONDS)
  }

  const rows: (string | undefined)[][] = []
  let nextToken: string | undefined
  do {
    const page = (await deps.athena.send(
      new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId, NextToken: nextToken, MaxResults: 1000 }),
    )) as GetQueryResultsCommandOutput
    for (const row of page.ResultSet?.Rows ?? []) rows.push((row.Data ?? []).map((datum) => datum.VarCharValue))
    nextToken = page.NextToken
  } while (nextToken)

  const days = parseRows(rows)
  await deps.store.putDays(days, now)
  return {
    queryExecutionId,
    since,
    days: days.length,
    bytesScanned: execution?.Statistics?.DataScannedInBytes ?? 0,
  }
}

let deps: RefresherDependencies | undefined

export const handler = async (_event: unknown, context?: { getRemainingTimeInMillis?: () => number }): Promise<RefreshResult> => {
  deps ??= {
    athena: new AthenaClient({}),
    store: new AnalyticsStore(createTableConfig()),
    workgroup: required('ATHENA_WORKGROUP'),
    database: required('GLUE_DATABASE'),
    table: required('GLUE_TABLE'),
    windowDays: Number(required('WINDOW_DAYS')),
  }
  const result = await refresh(deps, () => context?.getRemainingTimeInMillis?.() ?? Infinity)
  console.log('Agregados recalculados', JSON.stringify(result))
  return result
}
