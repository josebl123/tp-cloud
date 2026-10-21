// λ seed: carga los datos de demo que la consigna permite. La invoca Terraform una vez al
// desplegar, con el contenido de terraform/organization/seed/demo.json y el usuario de staff que
// creó en Cognito.
//
// Usa las mismas operaciones del dominio que la API, en lugar de escribir ítems a mano: así los datos
// de demo tienen exactamente la forma que espera el resto del código. Es idempotente: lo que ya existe
// se deja como está, así que volver a invocarla no duplica nada.

import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
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

export const handler = async (input: SeedInput): Promise<SeedResult> => {
  const result = await seed(input, createTableConfig())
  console.log('Datos de demo', JSON.stringify(result))
  return result
}
