// λ broadcaster: consume q-push (FIFO, un lote por cola a la vez) y empuja a cada navegador la
// vista que le corresponde, por el WebSocket.
//
// No aplica deltas: siempre relee el estado actual. Un evento duplicado, tardío o desordenado puede
// provocar un push de más, nunca una pantalla incorrecta. Y los eventos de una misma cola que llegan
// juntos se resuelven con una sola lectura y un solo push por conexión.
//
// Cada conexión recibe solo lo que puede ver: el staff, el tablero; un cliente, su propio ticket.

import { ApiGatewayManagementApiClient, GoneException, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda'
import { boardView, queueSummary, ticketUrl } from '../api/views.js'
import { required } from '../consumers/sqs.js'
import { snapshot, ticketView } from '../domain/views.js'
import { omitNulls } from '../http/api.js'
import { createTableConfig } from '../persistence/client.js'
import type { Connection } from '../persistence/connections-store.js'
import { ConnectionsStore } from '../persistence/connections-store.js'
import { DirectoryStore } from '../persistence/directory-store.js'
import { QueueStore } from '../persistence/queue-store.js'

/**
 * El tope de un mensaje de WebSocket es 128 KB. El tablero de una cola muy larga puede pasarlo: en
 * ese caso se manda solo el aviso de que cambió, y el navegador lo pide por REST.
 */
export const MAX_FRAME_BYTES = 120 * 1024

export interface Pusher {
  /** false si la conexión ya no existe. */
  post(connectionId: string, data: string): Promise<boolean>
}

export interface BroadcasterDependencies {
  queues: QueueStore
  directory: DirectoryStore
  connections: ConnectionsStore
  pusher: Pusher
  siteUrl: string
  now?: () => Date
}

/** El mismo formato que los eventos SSE de la versión Java: `queue.updated` y `ticket.updated`. */
export function frame(type: 'queue.updated' | 'ticket.updated', data: unknown): string {
  const json = JSON.stringify({ type, data }, omitNulls)
  return Buffer.byteLength(json) > MAX_FRAME_BYTES ? JSON.stringify({ type: 'queue.changed' }) : json
}

/** Empuja la vista actual de una cola a todos los que la miran. */
export async function broadcast(queueId: string, deps: BroadcasterDependencies): Promise<number> {
  const connections = await deps.connections.byQueue(queueId)
  if (connections.length === 0) return 0

  const ticketEntries = [...new Set(connections.flatMap((connection) => (connection.kind === 'TICKET' ? [connection.entryId] : [])))]
  const state = await deps.queues.read(queueId, { entryIds: ticketEntries })
  const now = deps.now?.() ?? new Date()
  const establishmentName = (await deps.directory.establishment(state.queue.establishmentId))?.name ?? ''

  const board = connections.some((connection) => connection.kind === 'STAFF')
    ? frame('queue.updated', boardView(state, establishmentName, deps.siteUrl, now))
    : null
  const snap = snapshot(state)
  const summary = queueSummary(state.queue, establishmentName)

  const payloadFor = (connection: Connection): string | null => {
    if (connection.kind === 'STAFF') return board
    const entry = state.entries.find((candidate) => candidate.id === connection.entryId)
    if (!entry) return null
    return frame('ticket.updated', ticketView(snap, entry, summary, ticketUrl(deps.siteUrl, connection.ticketToken), now))
  }

  let pushed = 0
  await Promise.all(
    connections.map(async (connection) => {
      const payload = payloadFor(connection)
      if (!payload) return
      try {
        if (await deps.pusher.post(connection.connectionId, payload)) pushed++
        // El navegador se fue sin que llegara su $disconnect: se borra acá.
        else await deps.connections.delete(connection.connectionId)
      } catch (error) {
        // Un push que falla no se reintenta: el cliente detecta el corte, reconecta y relee por REST.
        console.warn('No se pudo empujar a', connection.connectionId, error)
      }
    }),
  )
  return pushed
}

/**
 * Agrupa el lote por cola. Si una cola falla, se informan todos sus mensajes: en una cola FIFO, un
 * mensaje fallido tiene que volver junto con los que lo siguen en su grupo.
 */
export async function handleBatch(records: readonly SQSRecord[], deps: BroadcasterDependencies): Promise<SQSBatchResponse> {
  const byQueue = new Map<string, SQSRecord[]>()
  for (const record of records) {
    // Un mensaje que no se puede leer no tiene cola a la que difundir: se descarta, sin tirar el lote.
    let queueId = ''
    try {
      queueId = String((JSON.parse(record.body) as { queueId?: string }).queueId ?? '')
    } catch {
      console.error('Mensaje ilegible, se descarta', record.messageId)
    }
    byQueue.set(queueId, [...(byQueue.get(queueId) ?? []), record])
  }

  const failures: SQSBatchResponse['batchItemFailures'] = []
  for (const [queueId, group] of byQueue) {
    try {
      if (queueId) await broadcast(queueId, deps)
    } catch (error) {
      console.error('No se pudo difundir la cola', queueId, error)
      failures.push(...group.map((record) => ({ itemIdentifier: record.messageId })))
    }
  }
  return { batchItemFailures: failures }
}

class ApiGatewayPusher implements Pusher {
  private readonly client: ApiGatewayManagementApiClient

  constructor(endpoint: string) {
    this.client = new ApiGatewayManagementApiClient({ endpoint })
  }

  async post(connectionId: string, data: string): Promise<boolean> {
    try {
      await this.client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: new TextEncoder().encode(data) }))
      return true
    } catch (error) {
      if (error instanceof GoneException) return false
      throw error
    }
  }
}

let deps: BroadcasterDependencies | undefined

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  if (!deps) {
    const main = createTableConfig()
    deps = {
      queues: new QueueStore(main),
      directory: new DirectoryStore(main),
      connections: new ConnectionsStore({ documents: main.documents, tableName: required('CONNECTIONS_TABLE') }),
      pusher: new ApiGatewayPusher(required('WS_ENDPOINT')),
      siteUrl: required('SITE_URL'),
    }
  }
  return handleBatch(event.Records, deps)
}
