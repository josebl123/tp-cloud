import type { PublishCommand } from '@aws-sdk/client-sns'
import type { SendMessageCommand } from '@aws-sdk/client-sqs'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { DynamoDBRecord } from 'aws-lambda'
import { describe, expect, it } from 'vitest'
import { MAX_DELAY_SECONDS, publish } from '../../src/handlers/stream-publisher.js'
import type { PublisherDependencies } from '../../src/handlers/stream-publisher.js'

const NOW = new Date('2026-03-02T15:00:00.000Z')

/** Un registro del stream con la forma que entrega Lambda. */
function record(sequence: string, item: Record<string, unknown>, eventName: 'INSERT' | 'MODIFY' = 'INSERT'): DynamoDBRecord {
  return {
    eventName,
    dynamodb: {
      SequenceNumber: sequence,
      Keys: marshall({ PK: item['PK'], SK: item['SK'] }) as never,
      NewImage: marshall(item, { removeUndefinedValues: true }) as never,
    },
  }
}

function eventItem(queueId: string, version: number, type: string, detail: Record<string, unknown> = {}, entryId: string | null = 'e1') {
  return {
    PK: `QUEUE#${queueId}#EV`,
    SK: `${String(version).padStart(12, '0')}#000#ev-${queueId}-${version}`,
    kind: 'EVENT',
    ttl: 1,
    id: `ev-${queueId}-${version}`,
    queueId,
    entryId,
    type,
    actorType: 'STAFF',
    actorId: 'u',
    cycle: 0,
    detail,
    occurredAt: NOW.toISOString(),
    queueVersion: version,
  }
}

function fakes(failOn?: string) {
  const published: PublishCommand['input'][] = []
  const scheduled: SendMessageCommand['input'][] = []
  const deps: PublisherDependencies = {
    sns: {
      async send(command) {
        if (failOn && command.input.MessageDeduplicationId === failOn) throw new Error('SNS caído')
        published.push(command.input)
        return {}
      },
    },
    sqs: {
      async send(command) {
        scheduled.push(command.input)
        return {}
      },
    },
    topicArn: 'arn:aws:sns:us-east-1:1:q-queue-events.fifo',
    lifecycleQueueUrl: 'https://sqs/q-lifecycle',
    now: () => NOW,
  }
  return { deps, published, scheduled }
}

describe('stream-publisher', () => {
  it('publica solo las altas de ítems de evento, agrupadas por cola y deduplicadas por id', async () => {
    const { deps, published, scheduled } = fakes()
    const result = await publish(
      [
        record('1', eventItem('q1', 1, 'ENTRY_JOINED')),
        record('2', { PK: 'QUEUE#q1', SK: 'W#00000001V', kind: 'ENTRY', id: 'e1' }),
        record('3', eventItem('q1', 2, 'ENTRY_SERVED'), 'MODIFY'),
      ],
      deps,
    )
    expect(result.batchItemFailures).toEqual([])
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({ MessageGroupId: 'q1', MessageDeduplicationId: 'ev-q1-1' })
    expect(published[0]?.MessageAttributes?.['type']?.StringValue).toBe('ENTRY_JOINED')
    // El cuerpo es el evento sin las claves ni los metadatos de DynamoDB.
    const body = JSON.parse(published[0]?.Message ?? '{}')
    expect(body).toMatchObject({ id: 'ev-q1-1', type: 'ENTRY_JOINED', queueVersion: 1 })
    expect(body).not.toHaveProperty('PK')
    expect(scheduled).toHaveLength(0)
  })

  it('un llamado programa el vencimiento de la gracia, con la demora tope de SQS', async () => {
    const { deps, scheduled } = fakes()
    const in120 = new Date(NOW.getTime() + 120_000).toISOString()
    const in3600 = new Date(NOW.getTime() + 3_600_000).toISOString()
    await publish(
      [
        record('1', eventItem('q1', 1, 'ENTRY_CALLED', { graceExpiresAt: in120 })),
        record('2', eventItem('q2', 1, 'ENTRY_CALLED', { graceExpiresAt: in3600 })),
        record('3', eventItem('q3', 1, 'ENTRY_CALLED', { graceExpiresAt: null })),
        record('4', eventItem('q4', 1, 'QUEUE_CLOSED', {}, null)),
      ],
      deps,
    )
    expect(scheduled.map((message) => [JSON.parse(message.MessageBody ?? '{}').kind, message.DelaySeconds])).toEqual([
      ['GRACE', 120],
      ['GRACE', MAX_DELAY_SECONDS],
      ['RELEASE', 0],
    ])
    expect(JSON.parse(scheduled[0]?.MessageBody ?? '{}')).toMatchObject({ queueId: 'q1', entryId: 'e1', graceExpiresAt: in120 })
  })

  it('ordena por cola y versión, aunque el stream los entregue desordenados', async () => {
    const { deps, published } = fakes()
    await publish(
      [record('1', eventItem('q1', 3, 'ENTRY_SERVED')), record('2', eventItem('q1', 2, 'ENTRY_CALLED')), record('3', eventItem('q1', 1, 'ENTRY_JOINED'))],
      deps,
    )
    expect(published.map((input) => input.MessageDeduplicationId)).toEqual(['ev-q1-1', 'ev-q1-2', 'ev-q1-3'])
  })

  it('si una publicación falla, informa el primer registro pendiente en el orden del stream', async () => {
    const { deps, published } = fakes('ev-q1-2')
    const result = await publish(
      [record('10', eventItem('q1', 1, 'ENTRY_JOINED')), record('11', eventItem('q1', 2, 'ENTRY_CALLED')), record('12', eventItem('q1', 3, 'ENTRY_SERVED'))],
      deps,
    )
    expect(published.map((input) => input.MessageDeduplicationId)).toEqual(['ev-q1-1'])
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: '11' }])
  })
})
