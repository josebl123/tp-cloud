import type { PutRecordBatchCommand } from '@aws-sdk/client-firehose'
import type { SQSRecord } from 'aws-lambda'
import { describe, expect, it } from 'vitest'
import type { ArchiverDependencies } from '../../src/handlers/archiver.js'
import { archive } from '../../src/handlers/archiver.js'
import type { Entry } from '../../src/domain/types.js'
import { entry, lane, queueState } from '../domain/fixtures.js'

const finished = (id: string, overrides: Partial<Entry> = {}): Entry =>
  entry(id, 1, {
    status: 'SERVED',
    calledAt: '2026-03-02T15:10:00.000Z',
    servingStartedAt: '2026-03-02T15:11:00.000Z',
    finishedAt: '2026-03-02T15:30:00.000Z',
    ...overrides,
  })

function message(messageId: string, entryId: string | null, type = 'ENTRY_SERVED'): SQSRecord {
  return { messageId, body: JSON.stringify({ id: `ev-${messageId}`, queueId: 'queue-1', entryId, type }) } as SQSRecord
}

function fakes(entries: Entry[], firehose: (command: PutRecordBatchCommand) => { ErrorCode?: string }[] = (c) => (c.input.Records ?? []).map(() => ({}))) {
  const sent: PutRecordBatchCommand['input'][] = []
  const state = queueState()
  const deps: ArchiverDependencies = {
    queues: {
      async loadEntryById(id) {
        if (id === 'roto') throw new Error('DynamoDB caído')
        return entries.find((candidate) => candidate.id === id) ?? null
      },
      async configuration() {
        return { queue: state.queue, lanes: [lane('lane-default', { name: 'General' })] }
      },
    },
    directory: {
      async establishment(id) {
        return { id, name: 'Café Central', timezone: 'America/Argentina/Buenos_Aires', createdAt: '2026-01-01T00:00:00.000Z' }
      },
    },
    firehose: {
      async send(command) {
        sent.push(command.input)
        return { RequestResponses: firehose(command) }
      },
    },
    deliveryStreamName: 'q-visitas',
  }
  return { deps, sent }
}

const facts = (input: PutRecordBatchCommand['input']) =>
  (input.Records ?? []).map((record) => JSON.parse(Buffer.from(record.Data as Uint8Array).toString()) as Record<string, unknown>)

describe('archiver', () => {
  it('manda en un solo pedido el hecho de cada visita terminada', async () => {
    const { deps, sent } = fakes([finished('e1'), finished('e2', { status: 'LEFT', calledAt: null, servingStartedAt: null })])
    const result = await archive([message('m1', 'e1'), message('m2', 'e2', 'ENTRY_LEFT')], deps)
    expect(result.batchItemFailures).toEqual([])
    expect(sent).toHaveLength(1)
    expect(sent[0]?.DeliveryStreamName).toBe('q-visitas')
    expect(facts(sent[0]!).map((fact) => [fact['visit_id'], fact['outcome'], fact['lane_name']])).toEqual([
      ['e1', 'SERVED', 'General'],
      ['e2', 'LEFT', 'General'],
    ])
  })

  it('descarta las visitas que siguen (un ausente que volvió a la fila) y las que ya no existen', async () => {
    const { deps, sent } = fakes([entry('e1', 1, { noShowCount: 1 })])
    const result = await archive([message('m1', 'e1', 'ENTRY_NO_SHOW'), message('m2', 'borrada'), message('m3', null)], deps)
    expect(result.batchItemFailures).toEqual([])
    expect(sent).toHaveLength(0)
  })

  it('reintenta solo los mensajes que fallaron o que Firehose rechazó', async () => {
    const { deps } = fakes([finished('e1'), finished('e2')], () => [{}, { ErrorCode: 'ServiceUnavailableException' }])
    const result = await archive([message('m1', 'e1'), message('m2', 'e2'), message('m3', 'roto')], deps)
    expect(result.batchItemFailures.map((failure) => failure.itemIdentifier).sort()).toEqual(['m2', 'm3'])
  })

  it('reintenta todo el lote si Firehose no responde', async () => {
    const { deps } = fakes([finished('e1'), finished('e2')], () => {
      throw new Error('timeout')
    })
    const result = await archive([message('m1', 'e1'), message('m2', 'e2')], deps)
    expect(result.batchItemFailures.map((failure) => failure.itemIdentifier)).toEqual(['m1', 'm2'])
  })
})
