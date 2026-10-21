import { beforeAll, describe, expect, it } from 'vitest'
import { RELEASE_BATCH_SIZE, callNext, join, markServed, releaseBatch, startServing } from '../../src/domain/entries.js'
import { changeStatus } from '../../src/domain/queues.js'
import { CUSTOMER, staff } from '../../src/domain/state.js'
import type { Entry } from '../../src/domain/types.js'
import * as keys from '../../src/persistence/keys.js'
import type { Fixture } from './support.js'
import { createQueue, fixture } from './support.js'

const STAFF = staff('user-1')
let f: Fixture

beforeAll(async () => {
  f = await fixture()
})

const at = (iso: string) => () => new Date(iso)

describe('QueueStore contra DynamoDB Local', () => {
  it('crea una cola con su carril, su fila en el listado y su evento', async () => {
    const queueId = await createQueue(f.queues)
    const state = await f.queues.load(queueId)
    expect(state.queue).toMatchObject({ id: queueId, name: 'Mesas', status: 'OPEN', version: 0 })
    expect(state.lanes.map((lane) => lane.name)).toEqual(['1+'])
    expect(await f.directory.queuesOf('est-1')).toContainEqual({ queueId, name: 'Mesas', status: 'OPEN', archivedAt: null })
    expect((await f.queues.events(queueId)).map((event) => event['type'])).toEqual(['QUEUE_CREATED'])
  })

  it('después de unirse, el cliente encuentra su ticket: se lee lo que se escribió', async () => {
    const queueId = await createQueue(f.queues)
    const { result: ana } = await f.queues.mutate(queueId, (s) => join(s, { name: 'Ana', email: 'ana@example.com' }))
    const ticket = await f.queues.resolveTicket(ana.ticketToken)
    expect(ticket).toEqual({ queueId, entryId: ana.id })
    const state = await f.queues.load(queueId)
    expect(state.entries.map((entry) => entry.id)).toEqual([ana.id])
    expect(state.queue.version).toBe(1)
  })

  it('cada cambio de estado mueve la entrada de SK y mantiene su referencia', async () => {
    const queueId = await createQueue(f.queues)
    const { result: ana } = await f.queues.mutate(queueId, (s) => join(s, { name: 'Ana', email: 'a@x.y' }))
    await f.queues.mutate(queueId, (s) => callNext(s, STAFF), { now: at('2026-03-02T15:00:00Z') })
    await f.queues.mutate(queueId, (s) => startServing(s, ana.id, STAFF), { now: at('2026-03-02T15:01:00Z') })
    const { state } = await f.queues.mutate(queueId, (s) => markServed(s, ana.id, STAFF), {
      now: at('2026-03-02T15:05:00Z'),
    })

    // Ya no está entre las activas, pero se la encuentra por id y su SK es el de terminada.
    expect(state.queue.recentServiceSeconds).toEqual([240])
    expect((await f.queues.load(queueId)).entries).toEqual([])
    const served = (await f.queues.loadEntryById(ana.id)) as Entry
    expect(served.status).toBe('SERVED')
    expect(keys.entrySk(served)).toBe(`F#2026-03-02T15:05:00.000Z#${ana.id}`)

    // Y las métricas la leen por rango de fecha.
    const finished = await f.queues.finishedBetween(queueId, '2026-03-02T03:00:00.000Z', '2026-03-03T03:00:00.000Z')
    expect(finished.map((entry) => entry.id)).toEqual([ana.id])
    expect(await f.queues.finishedBetween(queueId, '2026-03-03T03:00:00.000Z', '2026-03-04T03:00:00.000Z')).toEqual([])
  })

  it('el evento queda en la misma transacción, con la versión de la cola', async () => {
    const queueId = await createQueue(f.queues)
    await f.queues.mutate(queueId, (s) => join(s, { name: 'Ana', email: 'a@x.y' }))
    await f.queues.mutate(queueId, (s) => join(s, { name: 'Bruno', email: 'b@x.y' }))
    const events = await f.queues.events(queueId)
    expect(events.map((event) => [event['type'], event['queueVersion']])).toEqual([
      ['QUEUE_CREATED', 0],
      ['ENTRY_JOINED', 1],
      ['ENTRY_JOINED', 2],
    ])
    expect(events.every((event) => typeof event['ttl'] === 'number')).toBe(true)
  })

  it('una operación que falla no escribe nada', async () => {
    const queueId = await createQueue(f.queues)
    await expect(f.queues.mutate(queueId, (s) => callNext(s, STAFF))).rejects.toMatchObject({ code: 'QUEUE_EMPTY' })
    expect((await f.queues.load(queueId)).queue.version).toBe(0)
    expect(await f.queues.events(queueId)).toHaveLength(1)
  })

  it('leer vence la gracia pasada antes de responder', async () => {
    const queueId = await createQueue(f.queues, { gracePeriodSeconds: 60, noShowPolicy: 'MOVE_TO_END' })
    await f.queues.mutate(queueId, (s) => join(s, { name: 'Ana', email: 'a@x.y' }), { now: at('2026-03-02T15:00:00Z') })
    await f.queues.mutate(queueId, (s) => callNext(s, STAFF), { now: at('2026-03-02T15:00:00Z') })

    const before = await f.queues.read(queueId, { now: at('2026-03-02T15:00:30Z') })
    expect(before.entries[0]?.status).toBe('CALLED')
    const after = await f.queues.read(queueId, { now: at('2026-03-02T15:01:01Z') })
    expect(after.entries[0]).toMatchObject({ status: 'WAITING', noShowCount: 1, notificationCycle: 1 })
  })

  it('muchos llamados vencidos a la vez no traban la cola: se vencen en varias transacciones', async () => {
    const queueId = await createQueue(f.queues, { gracePeriodSeconds: 60, noShowPolicy: 'REMOVE' })
    for (let i = 0; i < 30; i++) {
      await f.queues.mutate(queueId, (s) => join(s, { name: `Cliente ${i}`, email: `c${i}@x.y` }), {
        now: at('2026-03-02T15:00:00Z'),
      })
      await f.queues.mutate(queueId, (s) => callNext(s, STAFF), { now: at('2026-03-02T15:00:00Z') })
    }

    // 30 vencimientos × 4 ítems no entran en una transacción. Sin tope, toda operación fallaría.
    const late = at('2026-03-02T15:05:00Z')
    const { result: ana } = await f.queues.mutate(queueId, (s) => join(s, { name: 'Ana', email: 'a@x.y' }), { now: late })
    await f.queues.read(queueId, { now: late })
    expect((await f.queues.load(queueId)).entries.map((entry) => entry.id)).toEqual([ana.id])
  })

  it('cerrar una cola con mucha gente se libera en lotes que entran en una transacción', async () => {
    const queueId = await createQueue(f.queues)
    for (let i = 0; i < 70; i++) {
      await f.queues.mutate(queueId, (s) => join(s, { name: `Cliente ${i}`, email: `c${i}@x.y` }))
    }
    await f.queues.mutate(queueId, (s) => changeStatus(s, 'CLOSED', STAFF))
    expect((await f.directory.queuesOf('est-1')).find((queue) => queue.queueId === queueId)?.status).toBe('CLOSED')

    let released = 0
    let rounds = 0
    for (;;) {
      const { result } = await f.queues.mutate(queueId, (s) => releaseBatch(s, RELEASE_BATCH_SIZE, CUSTOMER))
      if (result === 0) break
      released += result
      rounds++
    }
    expect(released).toBe(70)
    expect(rounds).toBe(3)
    expect((await f.queues.load(queueId)).entries).toEqual([])
  })

  it('rechaza una operación que no entra en una transacción, sin escribir nada', async () => {
    const queueId = await createQueue(f.queues)
    for (let i = 0; i < 40; i++) {
      await f.queues.mutate(queueId, (s) => join(s, { name: `Cliente ${i}`, email: `c${i}@x.y` }))
    }
    await f.queues.mutate(queueId, (s) => changeStatus(s, 'CLOSED', STAFF))
    // 40 entradas × (Delete + Update de la referencia + Put + evento) pasan los 100 ítems.
    await expect(f.queues.mutate(queueId, (s) => releaseBatch(s, 40, CUSTOMER))).rejects.toThrow(RangeError)
    expect((await f.queues.load(queueId)).entries).toHaveLength(40)
  })

  it('la lectura barata (eventual) devuelve lo mismo que la consistente', async () => {
    const queueId = await createQueue(f.queues)
    await f.queues.mutate(queueId, (s) => join(s, { name: 'Ana', email: 'a@x.y' }))
    const cheap = await f.queues.read(queueId, { consistent: false })
    expect(cheap.entries.map((entry) => entry.customerName)).toEqual(['Ana'])
  })

  it('el historial desde un instante corta en el primer evento anterior, sin leer el resto', async () => {
    const queueId = await createQueue(f.queues)
    for (const [minute, name] of [
      ['10', 'Viejo'],
      ['20', 'Medio'],
      ['30', 'Nuevo'],
    ] as const) {
      await f.queues.mutate(queueId, (s) => join(s, { name, email: `${name.toLowerCase()}@x.y` }), {
        now: at(`2026-03-02T15:${minute}:00Z`),
      })
    }
    const since = await f.queues.eventsSince(queueId, '2026-03-02T15:20:00.000Z')
    // Del más nuevo al más viejo, y nada anterior al instante pedido (ni el QUEUE_CREATED).
    expect(since.map((event) => event['occurredAt'])).toEqual(['2026-03-02T15:30:00.000Z', '2026-03-02T15:20:00.000Z'])
  })

  it('una cola que no existe es un 404 del dominio', async () => {
    await expect(f.queues.load('no-existe')).rejects.toMatchObject({ code: 'QUEUE_NOT_FOUND', status: 404 })
  })
})
