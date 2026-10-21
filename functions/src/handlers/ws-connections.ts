// λ ws-connections: las rutas $connect y $disconnect de la API WebSocket.
//
// El navegador no puede mandar headers al abrir un WebSocket, así que la credencial va en la URL:
//   ?ticket=<ticketToken>   un cliente: su ticket ya es público en la URL de su turno
//   ?wsTicket=<id>          el staff: un ticket de un solo uso que vence en un minuto, emitido por la
//                           API a un miembro de esa cola. Su token de Cognito nunca aparece en una URL.
//
// La cola queda fijada al conectar, así no hace falta una ruta para suscribirse: cada conexión
// cuesta una invocación al abrir y otra al cerrar.

import type { APIGatewayProxyResult } from 'aws-lambda'
import { createTableConfig } from '../persistence/client.js'
import { ConnectionsStore } from '../persistence/connections-store.js'
import { DirectoryStore } from '../persistence/directory-store.js'
import { QueueStore } from '../persistence/queue-store.js'

export interface WebSocketEvent {
  requestContext: { routeKey: string; connectionId: string }
  queryStringParameters?: Record<string, string | undefined> | null
}

export interface WsDependencies {
  queues: QueueStore
  directory: DirectoryStore
  connections: ConnectionsStore
  now?: () => Date
}

const reply = (statusCode: number): APIGatewayProxyResult => ({ statusCode, body: '' })

export async function route(event: WebSocketEvent, deps: WsDependencies): Promise<APIGatewayProxyResult> {
  const { routeKey, connectionId } = event.requestContext
  const now = deps.now?.() ?? new Date()

  if (routeKey === '$disconnect') {
    await deps.connections.delete(connectionId)
    return reply(200)
  }
  if (routeKey !== '$connect') return reply(400)

  const query = event.queryStringParameters ?? {}
  const connectedAt = now.toISOString()

  if (query['ticket']) {
    const ticket = await deps.queues.resolveTicket(query['ticket'])
    if (!ticket) return reply(403)
    await deps.connections.put(
      { connectionId, queueId: ticket.queueId, kind: 'TICKET', entryId: ticket.entryId, ticketToken: query['ticket'], connectedAt },
      now,
    )
    return reply(200)
  }

  if (query['wsTicket']) {
    const grant = await deps.directory.consumeWsTicket(query['wsTicket'], now)
    if (!grant) return reply(403)
    await deps.connections.put({ connectionId, queueId: grant.queueId, kind: 'STAFF', userId: grant.userId, connectedAt }, now)
    return reply(200)
  }

  // Responder algo distinto de 2xx en $connect rechaza la conexión.
  return reply(401)
}

let deps: WsDependencies | undefined

export const handler = async (event: WebSocketEvent): Promise<APIGatewayProxyResult> => {
  if (!deps) {
    const main = createTableConfig()
    const connectionsTable = process.env.CONNECTIONS_TABLE
    if (!connectionsTable) throw new Error('CONNECTIONS_TABLE no está configurada')
    deps = {
      queues: new QueueStore(main),
      directory: new DirectoryStore(main),
      connections: new ConnectionsStore({ documents: main.documents, tableName: connectionsTable }),
    }
  }
  return route(event, deps)
}
