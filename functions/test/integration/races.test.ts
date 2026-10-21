import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { beforeAll, describe, expect, it } from 'vitest'
import { callNext, join, startServing } from '../../src/domain/entries.js'
import { expireDue } from '../../src/domain/grace.js'
import { staff } from '../../src/domain/state.js'
import type { TableConfig } from '../../src/persistence/client.js'
import { QueueStore } from '../../src/persistence/queue-store.js'
import type { Fixture } from './support.js'
import { barrier, createQueue, fixture } from './support.js'

// Las cuatro carreras de una cola, que en la versión Java resolvía el `SELECT … FOR UPDATE`. Cada
// test fuerza el peor caso: una barrera hace que todos los escritores lean la misma versión antes
// de que cualquiera escriba, así que todos menos uno pierden la primera vez y tienen que releer.

let f: Fixture

beforeAll(async () => {
  f = await fixture()
})

/** Todos los intentos esperan en la barrera solo la primera vez. */
const firstAttemptAt = (gate: () => Promise<void>) => (attempt: number) => (attempt === 0 ? gate() : Promise.resolve())

async function queueWith(customers: number, settings = {}): Promise<string> {
  const queueId = await createQueue(f.queues, settings)
  for (let i = 0; i < customers; i++) {
    await f.queues.mutate(queueId, (s) => join(s, { name: `Cliente ${i}`, email: `c${i}@x.y` }))
  }
  return queueId
}

describe('carreras', () => {
  it('dos personas del staff llaman a la vez: dos llamados, a dos personas distintas', async () => {
    const queueId = await queueWith(3)
    const gate = barrier(2)
    const [first, second] = await Promise.all(
      ['staff-a', 'staff-b'].map((user) =>
        f.queues.mutate(queueId, (s) => callNext(s, staff(user)), { afterLoad: firstAttemptAt(gate) }),
      ),
    )
    expect(first?.result.id).not.toBe(second?.result.id)
    expect((first?.retries ?? 0) + (second?.retries ?? 0)).toBeGreaterThanOrEqual(1)

    const state = await f.queues.load(queueId)
    expect(state.entries.filter((entry) => entry.status === 'CALLED')).toHaveLength(2)
    expect(state.queue.version).toBe(3 + 2)
  })

  it('tres a la vez también: ninguno llama a alguien ya llamado', async () => {
    const queueId = await queueWith(5)
    const gate = barrier(3)
    const results = await Promise.all(
      ['a', 'b', 'c'].map((user) =>
        f.queues.mutate(queueId, (s) => callNext(s, staff(user)), { afterLoad: firstAttemptAt(gate), maxAttempts: 10 }),
      ),
    )
    expect(new Set(results.map((outcome) => outcome.result.id)).size).toBe(3)
  })

  it('dos clientes se unen a la vez: números de ticket distintos y correlativos', async () => {
    const queueId = await queueWith(0)
    const gate = barrier(2)
    const tickets = await Promise.all(
      ['Ana', 'Bruno'].map((name) =>
        f.queues.mutate(queueId, (s) => join(s, { name, email: `${name}@x.y` }), { afterLoad: firstAttemptAt(gate) }),
      ),
    )
    expect(tickets.map((outcome) => outcome.result.ticketNumber).sort()).toEqual([1, 2])
    const state = await f.queues.load(queueId)
    expect(new Set(state.entries.map((entry) => entry.orderKey)).size).toBe(2)
  })

  it('un join que compite por el último lugar: entra uno solo', async () => {
    const queueId = await queueWith(0, { maxSize: 1 })
    const gate = barrier(2)
    const outcomes = await Promise.allSettled(
      ['Ana', 'Bruno'].map((name) =>
        f.queues.mutate(queueId, (s) => join(s, { name, email: `${name}@x.y` }), { afterLoad: firstAttemptAt(gate) }),
      ),
    )
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: 'QUEUE_FULL' })
    expect((await f.queues.load(queueId)).entries).toHaveLength(1)
  })

  it('vence la gracia mientras el staff atiende: un solo efecto, gane quien gane', async () => {
    const queueId = await queueWith(1, { gracePeriodSeconds: 60, noShowPolicy: 'MOVE_TO_END' })
    const calledAt = new Date()
    const { result: called } = await f.queues.mutate(queueId, (s) => callNext(s, staff('a')), { now: () => calledAt })
    const afterGrace = new Date(calledAt.getTime() + 61_000)

    const gate = barrier(2)
    const outcomes = await Promise.allSettled([
      // El staff tiene su reloj antes del vencimiento; lifecycle, después.
      f.queues.mutate(queueId, (s) => startServing(s, called.id, staff('a')), {
        afterLoad: firstAttemptAt(gate),
        now: () => new Date(calledAt.getTime() + 59_000),
      }),
      f.queues.mutate(queueId, (s) => expireDue(s), { afterLoad: firstAttemptAt(gate), now: () => afterGrace }),
    ])

    const types = (await f.queues.events(queueId))
      .filter((event) => event['entryId'] === called.id)
      .map((event) => event['type'])
    const effects = types.filter((type) => type === 'ENTRY_SERVING_STARTED' || type === 'ENTRY_NO_SHOW')
    expect(effects).toHaveLength(1)

    const entry = (await f.queues.load(queueId)).entries.find((candidate) => candidate.id === called.id)
    if (effects[0] === 'ENTRY_SERVING_STARTED') {
      expect(entry?.status).toBe('SERVING')
    } else {
      // Ganó el vencimiento: el staff relee, la encuentra esperando y su transición no aplica.
      expect(entry?.status).toBe('WAITING')
      expect(outcomes[0]).toMatchObject({ status: 'rejected', reason: { code: 'INVALID_TRANSITION' } })
    }
  })

  it('una lectura que se cruza con un commit ajeno no arma la cola con dos momentos distintos', async () => {
    // Cola llena: X e Y esperan y el máximo es 2. Mientras alguien intenta unirse, el staff llama a X.
    const queueId = await queueWith(2, { maxSize: 2 })

    // Un store cuya consulta de llamados (A#) responde enseguida y cuya fila (W#) espera a que el
    // llamado se confirme: X ya no está en la fila y todavía no estaba entre los llamados. Sin la
    // verificación de versión, ese join veía una sola persona activa y entraba: tres en una cola de dos.
    let release: () => void = () => {}
    const committed = new Promise<void>((resolve) => {
      release = resolve
    })
    let inServiceRead: () => void = () => {}
    const sawInService = new Promise<void>((resolve) => {
      inServiceRead = resolve
    })
    let delayOnce = true
    const send = f.table.documents.send.bind(f.table.documents)
    const torn: TableConfig = { ...f.table, documents: Object.create(f.table.documents) }
    torn.documents.send = (async (command: unknown) => {
      if (delayOnce && command instanceof QueryCommand) {
        const prefix = command.input.ExpressionAttributeValues?.[':prefix']
        if (prefix === 'A#') {
          const page = await send(command as never)
          inServiceRead()
          return page
        }
        if (prefix === 'W#') {
          delayOnce = false
          await committed
        }
      }
      return send(command as never)
    }) as typeof torn.documents.send

    const joining = new QueueStore(torn).mutate(queueId, (s) => join(s, { name: 'Z', email: 'z@x.y' }), { maxAttempts: 1 })
    await sawInService
    await f.queues.mutate(queueId, (s) => callNext(s, staff('a')))
    release()

    await expect(joining).rejects.toMatchObject({ code: 'QUEUE_FULL' })
    expect((await f.queues.load(queueId)).entries).toHaveLength(2)
  })
})
