import type { SendMessageCommand } from '@aws-sdk/client-sqs'
import { beforeAll, describe, expect, it } from 'vitest'
import { callNext, join } from '../../src/domain/entries.js'
import { changeStatus } from '../../src/domain/queues.js'
import { staff } from '../../src/domain/state.js'
import type { DomainEvent } from '../../src/domain/types.js'
import { broadcast, frame, MAX_FRAME_BYTES } from '../../src/handlers/broadcaster.js'
import type { Pusher } from '../../src/handlers/broadcaster.js'
import { handleMessage } from '../../src/handlers/lifecycle.js'
import type { Mailer } from '../../src/handlers/notifier.js'
import { notify, SesMailer } from '../../src/handlers/notifier.js'
import type { PublishedEvent } from '../../src/handlers/stream-publisher.js'
import { route } from '../../src/handlers/ws-connections.js'
import { ConnectionsStore } from '../../src/persistence/connections-store.js'
import * as items from '../../src/persistence/items.js'
import type { Fixture } from './support.js'
import { createConnectionsTable, createQueue, fixture } from './support.js'

// Los consumidores de la Fase 5 contra DynamoDB Local. Lo único falso es lo que sale del sistema:
// el push por WebSocket, SES y el reenvío a SQS registran lo que reciben.

let f: Fixture
let connections: ConnectionsStore
const SITE = 'https://abc.execute-api.us-east-1.amazonaws.com/prod'

beforeAll(async () => {
  f = await fixture()
  connections = new ConnectionsStore(await createConnectionsTable())
  await f.directory.createEstablishment({ id: 'est-1', name: 'La Parrilla', timezone: 'America/Argentina/Buenos_Aires', createdAt: 'x' }, 'owner')
})

/** El último evento de un tipo, como lo publicaría stream-publisher. */
async function lastEvent(queueId: string, type: DomainEvent['type']): Promise<PublishedEvent> {
  const found = (await f.queues.events(queueId)).filter((item) => item['type'] === type).at(-1)
  if (!found) throw new Error(`no hay ${type}`)
  return items.strip<PublishedEvent>(found)
}

const connect = (connectionId: string, query: Record<string, string>) =>
  route({ requestContext: { routeKey: '$connect', connectionId }, queryStringParameters: query }, { queues: f.queues, directory: f.directory, connections })

describe('ws-connections', () => {
  it('un cliente conecta con su ticket; el staff, con un ticket de un solo uso', async () => {
    const queueId = await createQueue(f.queues)
    const { result: entry } = await f.queues.mutate(queueId, (s) => join(s, { name: 'Ana', email: 'ana@example.com' }))

    expect((await connect('c-cliente', { ticket: entry.ticketToken })).statusCode).toBe(200)
    expect((await connect('c-falso', { ticket: 'no-existe' })).statusCode).toBe(403)
    expect((await connect('c-anonimo', {})).statusCode).toBe(401)

    const { ticket } = await f.directory.issueWsTicket({ userId: 'staff-1', queueId })
    expect((await connect('c-staff', { wsTicket: ticket })).statusCode).toBe(200)
    // Un solo uso: presentarlo otra vez no abre otra conexión.
    expect((await connect('c-staff-2', { wsTicket: ticket })).statusCode).toBe(403)
    // Y uno vencido tampoco.
    const old = await f.directory.issueWsTicket({ userId: 'staff-1', queueId }, new Date(Date.now() - 120_000))
    expect((await connect('c-staff-3', { wsTicket: old.ticket })).statusCode).toBe(403)

    const watching = await connections.byQueue(queueId)
    expect(watching.map((connection) => [connection.connectionId, connection.kind]).sort()).toEqual([
      ['c-cliente', 'TICKET'],
      ['c-staff', 'STAFF'],
    ])

    await route({ requestContext: { routeKey: '$disconnect', connectionId: 'c-cliente' } }, { queues: f.queues, directory: f.directory, connections })
    expect((await connections.byQueue(queueId)).map((connection) => connection.connectionId)).toEqual(['c-staff'])
  })
})

describe('broadcaster', () => {
  it('le manda al staff el tablero y a cada cliente su ticket; borra las conexiones que ya no existen', async () => {
    const queueId = await createQueue(f.queues, { name: 'Cena' })
    const { result: ana } = await f.queues.mutate(queueId, (s) => join(s, { name: 'Ana', email: 'ana@example.com' }))
    await f.queues.mutate(queueId, (s) => join(s, { name: 'Bruno', email: 'bruno@example.com' }))
    await connections.put({ connectionId: 'staff', queueId, kind: 'STAFF', userId: 'u', connectedAt: 'x' })
    await connections.put({ connectionId: 'ana', queueId, kind: 'TICKET', entryId: ana.id, ticketToken: ana.ticketToken, connectedAt: 'x' })
    await connections.put({ connectionId: 'cerrada', queueId, kind: 'STAFF', userId: 'u', connectedAt: 'x' })

    const frames = new Map<string, { type: string; data: Record<string, unknown> }>()
    const pusher: Pusher = {
      async post(connectionId, data) {
        if (connectionId === 'cerrada') return false
        frames.set(connectionId, JSON.parse(data))
        return true
      },
    }
    await broadcast(queueId, { queues: f.queues, directory: f.directory, connections, pusher, siteUrl: SITE })

    expect(frames.get('staff')).toMatchObject({ type: 'queue.updated', data: { waitingCount: 2 } })
    expect(frames.get('ana')).toMatchObject({ type: 'ticket.updated', data: { customerName: 'Ana', lanePosition: 1 } })
    // Un cliente nunca recibe el tablero, con datos de otros.
    expect(JSON.stringify(frames.get('ana'))).not.toContain('Bruno')
    expect((await connections.byQueue(queueId)).map((connection) => connection.connectionId)).not.toContain('cerrada')
  })

  it('un tablero que no entra en un mensaje se reemplaza por el aviso de que cambió', () => {
    expect(JSON.parse(frame('queue.updated', { big: 'x'.repeat(MAX_FRAME_BYTES) }))).toEqual({ type: 'queue.changed' })
  })
})

describe('notifier', () => {
  const sent: { to: string; subject: string }[] = []
  const mailer: Mailer = {
    channel: 'EMAIL',
    async send(to, subject) {
      sent.push({ to, subject })
      return 'sent'
    },
  }
  const deps = () => ({ queues: f.queues, directory: f.directory, mailer, siteUrl: SITE })

  it('manda cada aviso una sola vez, en el idioma del cliente', async () => {
    const queueId = await createQueue(f.queues, { name: 'Cena' })
    await f.queues.mutate(queueId, (s) => join(s, { name: 'Ana', email: 'ana@example.com', locale: 'es' }))
    const joined = await lastEvent(queueId, 'ENTRY_JOINED')

    expect(await notify(joined, deps())).toBe(1)
    // El mismo evento de nuevo (SQS entrega al menos una vez): no se repite.
    expect(await notify(joined, deps())).toBe(0)

    await f.queues.mutate(queueId, (s) => callNext(s, staff('u')))
    await notify(await lastEvent(queueId, 'ENTRY_CALLED'), deps())

    expect(sent.filter((mail) => mail.to === 'ana@example.com').map((mail) => mail.subject)).toEqual([
      'Ya tenés tu lugar en Cena',
      '¡Es tu turno en Cena!',
    ])
    const history = await f.directory.notificationsOf(joined.entryId ?? '')
    expect(history.map((notice) => [notice.type, notice.status, notice.subject])).toEqual([
      ['TICKET_CREATED', 'SENT', 'Ya tenés tu lugar en Cena'],
      ['YOUR_TURN', 'SENT', '¡Es tu turno en Cena!'],
    ])
  })

  it('SES: sin remitente, o con un destinatario no verificado en el sandbox, simula el envío', async () => {
    expect(await new SesMailer(null).send('a@b.c', 's', 'b')).toBe('simulated')
    const rejected = Object.assign(new Error('Email address is not verified. The following identities failed the check'), { name: 'MessageRejected' })
    const sandbox = new SesMailer('demo@queue.example', { send: async () => Promise.reject(rejected) } as never)
    expect(await sandbox.send('a@b.c', 's', 'b')).toBe('simulated')
    const down = new SesMailer('demo@queue.example', { send: async () => Promise.reject(new Error('SES caído')) } as never)
    await expect(down.send('a@b.c', 's', 'b')).rejects.toThrow('SES caído')
  })
})

describe('lifecycle', () => {
  const resent: SendMessageCommand['input'][] = []
  const sqs = { async send(command: SendMessageCommand) { resent.push(command.input); return {} } }

  it('vence la gracia cuando corresponde, y si el mensaje llega antes, lo reprograma por lo que falta', async () => {
    const queueId = await createQueue(f.queues, { gracePeriodSeconds: 60, noShowPolicy: 'MOVE_TO_END' })
    await f.queues.mutate(queueId, (s) => join(s, { name: 'Ana', email: 'ana@example.com' }))
    const calledAt = new Date()
    const { result: called } = await f.queues.mutate(queueId, (s) => callNext(s, staff('u')), { now: () => calledAt })
    const message = { kind: 'GRACE' as const, queueId, entryId: called.id, cycle: 0, graceExpiresAt: called.graceExpiresAt ?? '' }

    const early = await handleMessage(message, { queues: f.queues, sqs, queueUrl: 'url', now: () => new Date(calledAt.getTime() + 20_000) })
    expect(early).toBe('rescheduled')
    expect(resent.at(-1)?.DelaySeconds).toBe(40)

    const due = await handleMessage(message, { queues: f.queues, sqs, queueUrl: 'url', now: () => new Date(calledAt.getTime() + 61_000) })
    expect(due).toBe('expired')
    const after = (await f.queues.load(queueId)).entries.find((entry) => entry.id === called.id)
    expect(after).toMatchObject({ status: 'WAITING', noShowCount: 1 })
  })

  it('al cerrar una cola, libera a todos en lotes que entran en una transacción', async () => {
    const queueId = await createQueue(f.queues)
    for (let i = 0; i < 30; i++) await f.queues.mutate(queueId, (s) => join(s, { name: `C${i}`, email: `c${i}@x.y` }))
    await f.queues.mutate(queueId, (s) => changeStatus(s, 'CLOSED', staff('u')))

    expect(await handleMessage({ kind: 'RELEASE', queueId }, { queues: f.queues, sqs, queueUrl: 'url' })).toBe('released')
    expect((await f.queues.load(queueId)).entries).toHaveLength(0)
  })
})
