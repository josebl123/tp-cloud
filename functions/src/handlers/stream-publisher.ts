// λ stream-publisher: lee el stream de q-main y publica cada evento de dominio en el bus.
//
// Los eventos son ítems escritos en la misma transacción que el cambio que describen: existen si y
// solo si el cambio se confirmó. Esta función solo los reparte:
//
//   todos          → SNS FIFO q-queue-events, agrupados por cola y deduplicados por id
//   ENTRY_CALLED   → SQS q-lifecycle, con demora hasta que vence la gracia
//   QUEUE_CLOSED   → SQS q-lifecycle, sin demora, para liberar la fila en lotes
//
// Todo es idempotente aguas abajo: si un lote se reprocesa, SNS descarta los ids repetidos (ventana
// de 5 minutos) y lifecycle no aplica dos veces el mismo vencimiento.

import type { AttributeValue } from '@aws-sdk/client-dynamodb'
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { DynamoDBBatchResponse, DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda'
import type { DomainEvent } from '../domain/types.js'
import { strip } from '../persistence/items.js'

/** La demora máxima de un mensaje de SQS. Una gracia más larga la vuelve a programar lifecycle. */
export const MAX_DELAY_SECONDS = 900

export type PublishedEvent = DomainEvent & { queueVersion: number }

export type LifecycleMessage =
  | { kind: 'GRACE'; queueId: string; entryId: string; cycle: number | null; graceExpiresAt: string }
  | { kind: 'RELEASE'; queueId: string }

export interface PublisherDependencies {
  sns: { send(command: PublishCommand): Promise<unknown> }
  sqs: { send(command: SendMessageCommand): Promise<unknown> }
  topicArn: string
  lifecycleQueueUrl: string
  now?: () => Date
}

/** El evento de un registro del stream, o null si no es la creación de un ítem de evento. */
export function eventOf(record: DynamoDBRecord): PublishedEvent | null {
  // El filtro del event source mapping ya descarta lo demás antes de invocar la función. Se vuelve a
  // mirar acá para que un filtro mal escrito no pueda publicar entradas ni configuraciones.
  if (record.eventName !== 'INSERT') return null
  const image = record.dynamodb?.NewImage
  if (!image) return null
  const item = unmarshall(image as Record<string, AttributeValue>)
  if (item['kind'] !== 'EVENT') return null
  return strip<PublishedEvent>(item)
}

/** Qué hay que programar en q-lifecycle por este evento, si algo. */
export function lifecycleMessageFor(
  event: PublishedEvent,
  now: Date,
): { body: LifecycleMessage; delaySeconds: number } | null {
  if (event.type === 'ENTRY_CALLED') {
    const graceExpiresAt = event.detail['graceExpiresAt']
    // Una gracia de cero significa que el establecimiento no quiere ausencias automáticas.
    if (typeof graceExpiresAt !== 'string' || !event.entryId) return null
    const remaining = Math.ceil((Date.parse(graceExpiresAt) - now.getTime()) / 1000)
    return {
      body: { kind: 'GRACE', queueId: event.queueId, entryId: event.entryId, cycle: event.cycle, graceExpiresAt },
      delaySeconds: Math.min(MAX_DELAY_SECONDS, Math.max(0, remaining)),
    }
  }
  if (event.type === 'QUEUE_CLOSED') {
    return { body: { kind: 'RELEASE', queueId: event.queueId }, delaySeconds: 0 }
  }
  return null
}

async function publishOne(event: PublishedEvent, deps: PublisherDependencies): Promise<void> {
  await deps.sns.send(
    new PublishCommand({
      TopicArn: deps.topicArn,
      Message: JSON.stringify(event),
      // FIFO por cola: los eventos de una cola llegan en orden; colas distintas avanzan en paralelo.
      MessageGroupId: event.queueId,
      MessageDeduplicationId: event.id,
      // El filtro de la suscripción de q-notifications mira `type`.
      MessageAttributes: {
        type: { DataType: 'String', StringValue: event.type },
        queueId: { DataType: 'String', StringValue: event.queueId },
      },
    }),
  )

  const lifecycle = lifecycleMessageFor(event, deps.now?.() ?? new Date())
  if (lifecycle) {
    await deps.sqs.send(
      new SendMessageCommand({
        QueueUrl: deps.lifecycleQueueUrl,
        MessageBody: JSON.stringify(lifecycle.body),
        DelaySeconds: lifecycle.delaySeconds,
      }),
    )
  }
}

/**
 * Publica los eventos de un lote. Si uno falla, devuelve el primer registro (en el orden del stream)
 * que todavía no se publicó: Lambda reintenta desde ahí, y lo que ya salió y se vuelve a publicar lo
 * descarta la deduplicación de SNS.
 */
export async function publish(records: readonly DynamoDBRecord[], deps: PublisherDependencies): Promise<DynamoDBBatchResponse> {
  const items = records.map((record, index) => ({ record, index, event: eventOf(record) }))
  const done = new Set(items.filter((item) => item.event === null).map((item) => item.index))

  // DynamoDB garantiza el orden del stream por ítem, no entre ítems distintos. Cada evento lleva la
  // versión de su cola y su posición en la transacción: ordenar por eso los deja en el orden real.
  const pending = items
    .filter((item): item is typeof item & { event: PublishedEvent } => item.event !== null)
    .sort(
      (a, b) =>
        a.event.queueId.localeCompare(b.event.queueId) ||
        a.event.queueVersion - b.event.queueVersion ||
        String(a.record.dynamodb?.Keys?.['SK']?.S ?? '').localeCompare(String(b.record.dynamodb?.Keys?.['SK']?.S ?? '')),
    )

  for (const item of pending) {
    try {
      await publishOne(item.event, deps)
      done.add(item.index)
    } catch (error) {
      console.error('No se pudo publicar el evento', item.event.id, item.event.type, error)
      const firstPending = items.find((candidate) => !done.has(candidate.index))
      const sequenceNumber = firstPending?.record.dynamodb?.SequenceNumber
      return { batchItemFailures: sequenceNumber ? [{ itemIdentifier: sequenceNumber }] : [] }
    }
  }
  return { batchItemFailures: [] }
}

let deps: PublisherDependencies | undefined

export const handler = async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
  deps ??= {
    sns: new SNSClient({}),
    sqs: new SQSClient({}),
    topicArn: required('TOPIC_ARN'),
    lifecycleQueueUrl: required('LIFECYCLE_QUEUE_URL'),
  }
  return publish(event.Records, deps)
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} no está configurada`)
  return value
}
