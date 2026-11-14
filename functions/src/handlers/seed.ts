// λ seed: carga los datos de demo que la consigna permite. La invoca Terraform una vez al
// desplegar, con el contenido de terraform/organization/seed/demo.json y el usuario de staff que
// creó en Cognito.
//
// Usa las mismas operaciones del dominio que la API, en lugar de escribir ítems a mano: así los datos
// de demo tienen exactamente la forma que espera el resto del código. Es idempotente: lo que ya existe
// se deja como está, así que volver a invocarla no duplica nada.
//
// Con `{ history }` carga además meses de visitas inventadas en el data lake, por el mismo Firehose
// que usa el archiver (analytics/history.ts explica cómo se arman).

import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { FirehoseClient, PutRecordBatchCommand } from '@aws-sdk/client-firehose'
import type { PutRecordBatchCommandOutput } from '@aws-sdk/client-firehose'
import type { VisitFact } from '../analytics/fact.js'
import type { HistoryInput } from '../analytics/history.js'
import { historicalFacts } from '../analytics/history.js'
import { required } from '../consumers/sqs.js'
import { DomainError } from '../domain/errors.js'
import type { LaneSettings, QueueSettings } from '../domain/queues.js'
import { createLane, DEFAULT_LANE_NAME, newQueueState, updateLane } from '../domain/queues.js'
import { staff } from '../domain/state.js'
import type { Lane } from '../domain/types.js'
import { createTableConfig } from '../persistence/client.js'
import type { TableConfig } from '../persistence/client.js'
import { DirectoryStore } from '../persistence/directory-store.js'
import { QueueStore } from '../persistence/queue-store.js'

export interface SeedInput {
  establishment: { id: string; name: string; timezone: string }
  owner: { sub: string; email: string; displayName: string }
  queues: {
    id: string
    /** El carril con el que nace toda cola. Si hay `lanes`, se reconfigura con el primero. */
    defaultLaneId: string
    settings: QueueSettings & { name: string }
    lanes?: (LaneSettings & { id: string })[]
  }[]
}

export interface SeedResult {
  establishment: 'created' | 'existing'
  queues: Record<string, 'created' | 'existing'>
}

const alreadyExists = (error: unknown) =>
  error instanceof TransactionCanceledException ||
  error instanceof ConditionalCheckFailedException ||
  (error instanceof DomainError && error.code === 'QUEUE_EXISTS')

export async function seed(input: SeedInput, table: TableConfig, now = new Date()): Promise<SeedResult> {
  const directory = new DirectoryStore(table)
  const queues = new QueueStore(table)
  const owner = staff(input.owner.sub)
  const result: SeedResult = { establishment: 'created', queues: {} }

  try {
    await directory.createEstablishment({ ...input.establishment, createdAt: now.toISOString() }, input.owner.sub, {
      email: input.owner.email,
      displayName: input.owner.displayName,
    })
  } catch (error) {
    if (!alreadyExists(error)) throw error
    result.establishment = 'existing'
  }

  for (const queue of input.queues) {
    const state = newQueueState({ queueId: queue.id, laneId: queue.defaultLaneId }, input.establishment.id, queue.settings, now)
    try {
      await queues.create(
        state,
        (session) => {
          session.record('QUEUE_CREATED', owner, null)
          const [first, ...rest] = queue.lanes ?? []
          if (!first) return
          // El carril por defecto pasa a ser el primero de la lista; los demás se agregan.
          const lane = session.state.lanes[0] as Lane
          updateLane(session, lane.id, { ...first, name: first.name || DEFAULT_LANE_NAME }, owner)
          for (const extra of rest) createLane(session, extra.id, extra, owner)
        },
        now,
      )
      result.queues[queue.id] = 'created'
    } catch (error) {
      if (!alreadyExists(error)) throw error
      result.queues[queue.id] = 'existing'
    }
  }
  return result
}

/** El máximo de registros de un PutRecordBatch. */
export const FIREHOSE_BATCH = 500
const FIREHOSE_ATTEMPTS = 5

export interface HistoryDependencies {
  firehose: { send(command: PutRecordBatchCommand): Promise<Pick<PutRecordBatchCommandOutput, 'RequestResponses'>> }
  deliveryStreamName: string
  /** Espera entre reintentos; los tests la anulan. */
  pause?: (milliseconds: number) => Promise<void>
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

/** Manda los hechos a Firehose de a lotes. Los registros que rechaza se reintentan solos. */
export async function sendFacts(facts: readonly VisitFact[], deps: HistoryDependencies): Promise<number> {
  const pause = deps.pause ?? sleep
  for (let start = 0; start < facts.length; start += FIREHOSE_BATCH) {
    let pending = facts.slice(start, start + FIREHOSE_BATCH)
    for (let attempt = 1; pending.length > 0; attempt++) {
      if (attempt > FIREHOSE_ATTEMPTS) throw new Error(`Firehose rechazó ${pending.length} registros después de ${FIREHOSE_ATTEMPTS} intentos`)
      const batch = pending
      const { RequestResponses = [] } = await deps.firehose.send(
        new PutRecordBatchCommand({
          DeliveryStreamName: deps.deliveryStreamName,
          Records: batch.map((fact) => ({ Data: Buffer.from(`${JSON.stringify(fact)}\n`) })),
        }),
      )
      pending = batch.filter((_, index) => !RequestResponses[index] || RequestResponses[index]?.ErrorCode)
      if (pending.length > 0) await pause(200 * 2 ** attempt)
    }
  }
  return facts.length
}

export async function seedHistory(input: HistoryInput, deps: HistoryDependencies, now = new Date()): Promise<{ visits: number }> {
  return { visits: await sendFacts(historicalFacts(input, now), deps) }
}

export const handler = async (input: SeedInput | { history: HistoryInput }): Promise<SeedResult | { visits: number }> => {
  if ('history' in input) {
    const result = await seedHistory(input.history, {
      firehose: new FirehoseClient({}),
      deliveryStreamName: required('DELIVERY_STREAM_NAME'),
    })
    console.log('Historial de demo', JSON.stringify(result))
    return result
  }
  const result = await seed(input, createTableConfig())
  console.log('Datos de demo', JSON.stringify(result))
  return result
}
