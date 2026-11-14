// λ archiver: consume q-analytics y carga en el data lake el hecho de cada visita que terminó.
//
// Es la E y la T de un ETL en streaming: extrae de la operación (la entrada en DynamoDB, en el
// estado en que terminó), la transforma en una fila de la tabla de hechos (ver analytics/fact.ts) y
// se la pasa a Firehose, que hace la L: junta los registros, los convierte a Parquet y los escribe
// en S3 particionados por día.
//
// q-analytics recibe solo los eventos que cierran una visita (atendido, se fue, ausente). Un ausente
// que vuelve a la fila no cerró nada: su entrada no está terminada y se descarta. La entrega es al
// menos una vez, así que un mismo hecho puede llegar dos veces; las consultas cuentan visitas
// distintas por `visit_id`.

import { FirehoseClient, PutRecordBatchCommand } from '@aws-sdk/client-firehose'
import type { PutRecordBatchCommandOutput } from '@aws-sdk/client-firehose'
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda'
import type { VisitFact } from '../analytics/fact.js'
import { visitFact } from '../analytics/fact.js'
import { required } from '../consumers/sqs.js'
import type { Entry, Establishment, Lane, Queue } from '../domain/types.js'
import { createTableConfig } from '../persistence/client.js'
import { DirectoryStore } from '../persistence/directory-store.js'
import { QueueStore } from '../persistence/queue-store.js'
import type { PublishedEvent } from './stream-publisher.js'

export interface ArchiverDependencies {
  queues: {
    loadEntryById(entryId: string): Promise<Entry | null>
    configuration(queueId: string): Promise<{ queue: Queue; lanes: Lane[] } | null>
  }
  directory: { establishment(establishmentId: string): Promise<Establishment | null> }
  firehose: { send(command: PutRecordBatchCommand): Promise<Pick<PutRecordBatchCommandOutput, 'RequestResponses'>> }
  deliveryStreamName: string
}

/** El hecho que deja un evento; null si no hay nada que archivar (la visita sigue, o ya no existe). */
export async function factFor(event: PublishedEvent, deps: ArchiverDependencies): Promise<VisitFact | null> {
  if (!event.entryId) return null
  const entry = await deps.queues.loadEntryById(event.entryId)
  if (!entry) return null
  const config = await deps.queues.configuration(entry.queueId)
  if (!config) return null
  const establishment = await deps.directory.establishment(config.queue.establishmentId)
  if (!establishment) return null
  return visitFact(entry, {
    establishment,
    queue: config.queue,
    lane: config.lanes.find((candidate) => candidate.id === entry.laneId) ?? null,
  })
}

/**
 * Arma los hechos del lote y los manda a Firehose en un solo pedido. Devuelve los mensajes que hay
 * que reintentar: los que no se pudieron leer y los registros que Firehose rechazó uno por uno.
 */
export async function archive(records: readonly SQSRecord[], deps: ArchiverDependencies): Promise<SQSBatchResponse> {
  const failures: SQSBatchResponse['batchItemFailures'] = []
  const pending: { messageId: string; fact: VisitFact }[] = []

  for (const record of records) {
    try {
      const fact = await factFor(JSON.parse(record.body) as PublishedEvent, deps)
      if (fact) pending.push({ messageId: record.messageId, fact })
    } catch (error) {
      console.error('Falló el mensaje', record.messageId, error)
      failures.push({ itemIdentifier: record.messageId })
    }
  }
  if (pending.length === 0) return { batchItemFailures: failures }

  try {
    const { RequestResponses = [] } = await deps.firehose.send(
      new PutRecordBatchCommand({
        DeliveryStreamName: deps.deliveryStreamName,
        // Un JSON por línea: Firehose lee cada registro con el esquema de la tabla de Glue.
        Records: pending.map(({ fact }) => ({ Data: Buffer.from(`${JSON.stringify(fact)}\n`) })),
      }),
    )
    // La respuesta trae un resultado por registro, en el mismo orden: un rechazo no invalida el resto.
    pending.forEach(({ messageId }, index) => {
      const response = RequestResponses[index]
      if (!response || response.ErrorCode) {
        console.error('Firehose rechazó el registro', messageId, response?.ErrorCode, response?.ErrorMessage)
        failures.push({ itemIdentifier: messageId })
      }
    })
  } catch (error) {
    console.error('Falló el envío a Firehose', error)
    failures.push(...pending.map(({ messageId }) => ({ itemIdentifier: messageId })))
  }
  return { batchItemFailures: failures }
}

let deps: ArchiverDependencies | undefined

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  if (!deps) {
    const main = createTableConfig()
    deps = {
      queues: new QueueStore(main),
      directory: new DirectoryStore(main),
      firehose: new FirehoseClient({}),
      deliveryStreamName: required('DELIVERY_STREAM_NAME'),
    }
  }
  return archive(event.Records, deps)
}
