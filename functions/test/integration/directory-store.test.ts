import { beforeAll, describe, expect, it } from 'vitest'
import type { NotificationRecord } from '../../src/domain/types.js'
import type { Fixture } from './support.js'
import { fixture } from './support.js'

let f: Fixture

beforeAll(async () => {
  f = await fixture()
})

describe('DirectoryStore contra DynamoDB Local', () => {
  it('crear un establecimiento deja a su creador como dueño, visible desde los dos lados', async () => {
    await f.directory.createEstablishment(
      { id: 'est-a', name: 'Café', timezone: 'America/Argentina/Buenos_Aires', createdAt: '2026-03-02T15:00:00.000Z' },
      'owner-sub',
    )
    expect(await f.directory.establishment('est-a')).toMatchObject({ name: 'Café' })
    expect(await f.directory.membership('owner-sub', 'est-a')).toMatchObject({ role: 'OWNER' })
    expect((await f.directory.membershipsOf('owner-sub')).map((m) => m.establishmentId)).toEqual(['est-a'])
    expect((await f.directory.membersOf('est-a')).map((m) => m.userId)).toEqual(['owner-sub'])
  })

  it('la membresía se revisa en cada request: sacar a alguien tiene efecto inmediato', async () => {
    await f.directory.putMembership({ userId: 'staff-sub', establishmentId: 'est-a', role: 'STAFF', createdAt: 'x' })
    await expect(f.directory.requireMember('staff-sub', 'est-a')).resolves.toMatchObject({ role: 'STAFF' })
    await expect(f.directory.requireMember('staff-sub', 'est-a', 'OWNER')).rejects.toMatchObject({
      code: 'OWNER_ONLY',
      status: 403,
    })
    await f.directory.removeMembership('staff-sub', 'est-a')
    await expect(f.directory.requireMember('staff-sub', 'est-a')).rejects.toMatchObject({ code: 'NOT_A_MEMBER' })
  })

  it('un aviso se reserva una sola vez por ciclo, salvo que el intento anterior haya fallado', async () => {
    const record: NotificationRecord = {
      entryId: 'entry-1',
      type: 'YOUR_TURN',
      cycle: 0,
      status: 'PENDING',
      channel: 'EMAIL',
      destination: 'ana@example.com',
      attempts: 0,
      createdAt: '2026-03-02T15:00:00.000Z',
      sentAt: null,
      failureReason: null,
    }
    const claimedAt = new Date('2026-03-02T15:00:00Z')
    expect(await f.directory.claimNotification(record, claimedAt)).toBe(true)
    // Un reintento de SQS mientras el primero sigue pendiente no lo vuelve a tomar.
    expect(await f.directory.claimNotification(record, new Date('2026-03-02T15:00:30Z'))).toBe(false)
    // Pero si quedó pendiente más que el lease, quien lo reservó murió antes de enviarlo: se retoma.
    expect(await f.directory.claimNotification(record, new Date('2026-03-02T15:02:01Z'))).toBe(true)

    await f.directory.markNotification('entry-1', 'YOUR_TURN', 0, { status: 'FAILED', reason: 'smtp caído' })
    expect(await f.directory.claimNotification(record)).toBe(true)
    await f.directory.markNotification('entry-1', 'YOUR_TURN', 0, { status: 'SENT', at: '2026-03-02T15:01:00.000Z' })
    expect(await f.directory.claimNotification(record)).toBe(false)

    // Un ciclo nuevo (volvió a la fila y la llaman otra vez) sí es un aviso nuevo.
    expect(await f.directory.claimNotification({ ...record, cycle: 1 })).toBe(true)

    const history = await f.directory.notificationsOf('entry-1')
    // Tres reservas: la primera, la retomada por lease y la que siguió al fallo.
    expect(history.find((notice) => notice.cycle === 0)).toMatchObject({ status: 'SENT', failureReason: null, attempts: 3 })
  })

  it('un aviso que siempre falla deja de reintentarse al agotar los intentos', async () => {
    const record: NotificationRecord = {
      entryId: 'entry-2',
      type: 'TICKET_CREATED',
      cycle: 0,
      status: 'PENDING',
      channel: 'EMAIL',
      destination: 'nadie@example.com',
      attempts: 0,
      createdAt: '2026-03-02T15:00:00.000Z',
      sentAt: null,
      failureReason: null,
    }
    const claims: boolean[] = []
    for (let i = 0; i < 4; i++) {
      const claimed = await f.directory.claimNotification(record, new Date(), 120, 3)
      claims.push(claimed)
      if (claimed) await f.directory.markNotification('entry-2', 'TICKET_CREATED', 0, { status: 'FAILED', reason: 'rechazado' })
    }
    expect(claims).toEqual([true, true, true, false])

    const [notice] = await f.directory.notificationsOf('entry-2')
    // El primer createdAt se conserva y el contador no se reinicia en cada reserva.
    expect(notice).toMatchObject({ status: 'FAILED', attempts: 3, createdAt: '2026-03-02T15:00:00.000Z', failureReason: 'rechazado' })
  })

  it('el límite por IP corta en el request número N+1 del mismo minuto', async () => {
    const now = new Date('2026-03-02T15:00:10Z')
    const results: boolean[] = []
    for (let i = 0; i < 4; i++) results.push(await f.directory.allowRequest('203.0.113.7', 3, now))
    expect(results).toEqual([true, true, true, false])
    expect(await f.directory.allowRequest('203.0.113.7', 3, new Date('2026-03-02T15:01:00Z'))).toBe(true)
    expect(await f.directory.allowRequest('198.51.100.1', 3, now)).toBe(true)
  })
})
