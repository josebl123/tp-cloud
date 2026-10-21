import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { randomUUID } from 'node:crypto'
import { inject } from 'vitest'
import { newQueueState } from '../../src/domain/queues.js'
import type { QueueSettings } from '../../src/domain/queues.js'
import { createTableConfig } from '../../src/persistence/client.js'
import type { TableConfig } from '../../src/persistence/client.js'
import { DirectoryStore } from '../../src/persistence/directory-store.js'
import { QueueStore } from '../../src/persistence/queue-store.js'

/**
 * Una tabla nueva con la misma forma que crea Terraform en `terraform/organization/tables.tf`: PK y
 * SK string, on-demand y con Streams. Si una cambia, la otra tiene que cambiar igual.
 */
export async function createTestTable(): Promise<TableConfig> {
  const endpoint = inject('dynamodbEndpoint')
  const tableName = `q-main-test-${randomUUID().slice(0, 8)}`
  const client = new DynamoDBClient({
    endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  })
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES' },
    }),
  )
  client.destroy()
  return createTableConfig({ tableName, endpoint })
}

export interface Fixture {
  table: TableConfig
  queues: QueueStore
  directory: DirectoryStore
}

export async function fixture(): Promise<Fixture> {
  const table = await createTestTable()
  return { table, queues: new QueueStore(table), directory: new DirectoryStore(table) }
}

/** Crea una cola nueva en la tabla y devuelve su id. */
export async function createQueue(queues: QueueStore, settings: QueueSettings = {}): Promise<string> {
  const queueId = randomUUID()
  const state = newQueueState({ queueId, laneId: randomUUID() }, 'est-1', { name: 'Mesas', ...settings }, new Date())
  await queues.create(state, (session) => session.record('QUEUE_CREATED', { type: 'STAFF', id: 'owner' }, null))
  return queueId
}

/** Una barrera: libera a todos los que esperan cuando llegan `parties`. */
export function barrier(parties: number): () => Promise<void> {
  let arrived = 0
  let release: () => void = () => {}
  const open = new Promise<void>((resolve) => {
    release = resolve
  })
  return () => {
    arrived++
    if (arrived >= parties) release()
    return open
  }
}

/** La tabla de conexiones con la misma forma que `connections_table` en tables.tf: PK y GSI byQueue. */
export async function createConnectionsTable(): Promise<TableConfig> {
  const endpoint = inject('dynamodbEndpoint')
  const tableName = `q-connections-test-${randomUUID().slice(0, 8)}`
  const client = new DynamoDBClient({ endpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } })
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'queueId', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        { IndexName: 'byQueue', KeySchema: [{ AttributeName: 'queueId', KeyType: 'HASH' }], Projection: { ProjectionType: 'ALL' } },
      ],
    }),
  )
  client.destroy()
  return createTableConfig({ tableName, endpoint })
}
