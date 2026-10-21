// λ lifecycle: consume q-lifecycle y aplica lo que dispara el sistema y no una persona:
//
//   GRACE     un llamado cuyo plazo venció: se aplica la política de ausencia de la cola
//   RELEASE   una cola cerrada: se libera a quienes quedaban, en lotes que entran en una transacción
//
// El mismo vencimiento puede dispararlo también cualquier lectura de la cola. Todos pasan por
// `expireDue` sobre el estado actual y con la versión de la cola: el primero gana, y para los demás
// ya no hay nada vencido. Si el staff atendió a la persona un segundo antes, no hay nada que vencer.

import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'
import { processEach, required } from '../consumers/sqs.js'
import { RELEASE_BATCH_SIZE, releaseBatch } from '../domain/entries.js'
import { DomainError } from '../domain/errors.js'
import { expireDue } from '../domain/grace.js'
import { SYSTEM } from '../domain/state.js'
import { createTableConfig } from '../persistence/client.js'
import { QueueStore } from '../persistence/queue-store.js'
import type { LifecycleMessage } from './stream-publisher.js'
import { MAX_DELAY_SECONDS } from './stream-publisher.js'

export interface LifecycleDependencies {
  queues: QueueStore
  sqs: { send(command: SendMessageCommand): Promise<unknown> }
  queueUrl: string
  now?: () => Date
}

/** Una cola de 1000 entradas se libera en 42 lotes: este tope solo corta un ciclo que no termina. */
const MAX_RELEASE_ROUNDS = 100

export type LifecycleOutcome = 'expired' | 'rescheduled' | 'released' | 'skipped'

export async function handleMessage(message: LifecycleMessage, deps: LifecycleDependencies): Promise<LifecycleOutcome> {
  try {
    if (message.kind === 'RELEASE') {
      for (let round = 0; round < MAX_RELEASE_ROUNDS; round++) {
        const { result: released } = await deps.queues.mutate(message.queueId, (session) =>
          releaseBatch(session, RELEASE_BATCH_SIZE, SYSTEM),
        )
        if (released < RELEASE_BATCH_SIZE) return 'released'
      }
      throw new Error(`La cola ${message.queueId} no terminó de liberarse en ${MAX_RELEASE_ROUNDS} lotes`)
    }

    const now = deps.now?.() ?? new Date()
    const remaining = Math.ceil((Date.parse(message.graceExpiresAt) - now.getTime()) / 1000)
    // SQS demora como mucho 15 minutos: una gracia más larga se programa por tramos. Y un mensaje que
    // llegó un instante antes de tiempo se vuelve a programar por lo que falta.
    if (remaining > 0) {
      await deps.sqs.send(
        new SendMessageCommand({
          QueueUrl: deps.queueUrl,
          MessageBody: JSON.stringify(message),
          DelaySeconds: Math.min(MAX_DELAY_SECONDS, remaining),
        }),
      )
      return 'rescheduled'
    }
    await deps.queues.mutate(message.queueId, (session) => expireDue(session), { now: () => now })
    return 'expired'
  } catch (error) {
    // Una cola que ya no existe no se va a arreglar reintentando.
    if (error instanceof DomainError && error.code === 'QUEUE_NOT_FOUND') return 'skipped'
    throw error
  }
}

let deps: LifecycleDependencies | undefined

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  deps ??= { queues: new QueueStore(createTableConfig()), sqs: new SQSClient({}), queueUrl: required('LIFECYCLE_QUEUE_URL') }
  const ready = deps
  return processEach(event.Records, async (record) => {
    await handleMessage(JSON.parse(record.body) as LifecycleMessage, ready)
  })
}
