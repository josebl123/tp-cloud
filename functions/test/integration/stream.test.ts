import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DescribeStreamCommand,
  DynamoDBStreamsClient,
  GetRecordsCommand,
  GetShardIteratorCommand,
} from '@aws-sdk/client-dynamodb-streams'
import type { DynamoDBRecord } from 'aws-lambda'
import { beforeAll, expect, it } from 'vitest'
import { inject } from 'vitest'
import { callNext, join } from '../../src/domain/entries.js'
import { staff } from '../../src/domain/state.js'
import { publish } from '../../src/handlers/stream-publisher.js'
import type { PublisherDependencies } from '../../src/handlers/stream-publisher.js'
import type { Fixture } from './support.js'
import { createQueue, fixture } from './support.js'

// El recorrido real de la Fase 4 hasta donde llega DynamoDB Local: operar una cola, leer su stream
// tal como lo leería el event source mapping, y ver qué publica stream-publisher. Solo SNS y SQS son
// falsos.

let f: Fixture
const local = { endpoint: '', region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }

beforeAll(async () => {
  f = await fixture()
  local.endpoint = inject('dynamodbEndpoint')
})

/**
 * El cliente del SDK deserializa un mapa vacío (`{"M": {}}`) como `{}`, que `unmarshall` rechaza.
 * Lambda entrega el JSON del servicio tal cual, con su `M`: esto lo vuelve a dejar así.
 */
function asDelivered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(asDelivered)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value)
  if (entries.length === 0) return { M: {} }
  return Object.fromEntries(entries.map(([key, inner]) => [key, asDelivered(inner)]))
}

async function streamRecords(): Promise<DynamoDBRecord[]> {
  const table = await new DynamoDBClient(local).send(new DescribeTableCommand({ TableName: f.table.tableName }))
  const streams = new DynamoDBStreamsClient(local)
  const { StreamDescription } = await streams.send(new DescribeStreamCommand({ StreamArn: table.Table?.LatestStreamArn }))
  const records: DynamoDBRecord[] = []
  for (const shard of StreamDescription?.Shards ?? []) {
    let { ShardIterator } = await streams.send(
      new GetShardIteratorCommand({ StreamArn: table.Table?.LatestStreamArn, ShardId: shard.ShardId, ShardIteratorType: 'TRIM_HORIZON' }),
    )
    while (ShardIterator) {
      const page = await streams.send(new GetRecordsCommand({ ShardIterator }))
      for (const raw of page.Records ?? []) {
        const image = raw.dynamodb?.NewImage
        records.push({
          ...raw,
          dynamodb: { ...raw.dynamodb, ...(image ? { NewImage: Object.fromEntries(Object.entries(image).map(([key, value]) => [key, asDelivered(value)])) } : {}) },
        } as unknown as DynamoDBRecord)
      }
      if (!page.Records?.length) break
      ShardIterator = page.NextShardIterator
    }
  }
  return records
}

it('unirse y llamar dejan sus eventos en el stream, y stream-publisher los publica y programa la gracia', async () => {
  const queueId = await createQueue(f.queues, { gracePeriodSeconds: 90 })
  await f.queues.mutate(queueId, (session) => join(session, { name: 'Ana', email: 'ana@example.com' }))
  const calledAt = new Date()
  await f.queues.mutate(queueId, (session) => callNext(session, staff('a')), { now: () => calledAt })

  const published: { group: string | undefined; type: string | undefined }[] = []
  const scheduled: { delay: number | undefined; body: Record<string, unknown> }[] = []
  const deps: PublisherDependencies = {
    sns: {
      async send(command) {
        published.push({ group: command.input.MessageGroupId, type: command.input.MessageAttributes?.['type']?.StringValue })
        return {}
      },
    },
    sqs: {
      async send(command) {
        scheduled.push({ delay: command.input.DelaySeconds, body: JSON.parse(command.input.MessageBody ?? '{}') })
        return {}
      },
    },
    topicArn: 'arn',
    lifecycleQueueUrl: 'url',
    now: () => calledAt,
  }

  const records = await streamRecords()
  // El stream trae todo lo que cambió (cola, entradas, ticket, referencia): solo los eventos salen.
  expect(records.length).toBeGreaterThan(3)
  expect((await publish(records, deps)).batchItemFailures).toEqual([])

  const ofThisQueue = published.filter((message) => message.group === queueId).map((message) => message.type)
  expect(ofThisQueue).toEqual(['QUEUE_CREATED', 'ENTRY_JOINED', 'ENTRY_CALLED'])
  expect(scheduled).toHaveLength(1)
  expect(scheduled[0]?.delay).toBe(90)
  expect(scheduled[0]?.body).toMatchObject({ kind: 'GRACE', queueId })
})
