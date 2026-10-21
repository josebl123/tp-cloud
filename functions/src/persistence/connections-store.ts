// Las conexiones WebSocket abiertas, en su propia tabla (q-connections). Una por navegador, indexada
// por la cola que mira: el broadcaster encuentra a todos los que hay que avisar con una sola consulta
// al índice `byQueue`.

import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { TableConfig } from './client.js'
import { epochSeconds } from './keys.js'

/** Lo más que API Gateway mantiene abierta una conexión, más un margen. Después la borra el TTL. */
export const CONNECTION_TTL_SECONDS = 2 * 3600 + 10 * 60

export type Connection =
  | { connectionId: string; queueId: string; kind: 'STAFF'; userId: string; connectedAt: string }
  | { connectionId: string; queueId: string; kind: 'TICKET'; entryId: string; ticketToken: string; connectedAt: string }

const connectionPk = (connectionId: string) => `CONN#${connectionId}`

export class ConnectionsStore {
  constructor(private readonly table: TableConfig) {}

  async put(connection: Connection, now = new Date()): Promise<void> {
    await this.table.documents.send(
      new PutCommand({
        TableName: this.table.tableName,
        Item: { PK: connectionPk(connection.connectionId), ...connection, ttl: epochSeconds(now) + CONNECTION_TTL_SECONDS },
      }),
    )
  }

  async delete(connectionId: string): Promise<void> {
    await this.table.documents.send(new DeleteCommand({ TableName: this.table.tableName, Key: { PK: connectionPk(connectionId) } }))
  }

  /**
   * Quiénes miran una cola. El índice es eventualmente consistente: una conexión recién abierta
   * puede perderse el primer aviso, pero su primera vista ya la trajo por REST.
   */
  async byQueue(queueId: string): Promise<Connection[]> {
    const found: Connection[] = []
    let start: Record<string, unknown> | undefined
    do {
      const page = await this.table.documents.send(
        new QueryCommand({
          TableName: this.table.tableName,
          IndexName: 'byQueue',
          KeyConditionExpression: 'queueId = :queueId',
          ExpressionAttributeValues: { ':queueId': queueId },
          ExclusiveStartKey: start,
        }),
      )
      for (const item of page.Items ?? []) {
        const { PK: _pk, ttl: _ttl, ...connection } = item
        found.push(connection as Connection)
      }
      start = page.LastEvaluatedKey
    } while (start)
    return found
  }
}
