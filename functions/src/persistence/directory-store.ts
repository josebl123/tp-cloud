// Todo lo que no es la fila: establecimientos, membresías, avisos y el límite por IP.

import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'node:crypto'
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { forbidden } from '../domain/errors.js'
import type { Establishment, Membership, MembershipRole, NotificationRecord, QueueStatus } from '../domain/types.js'
import type { TableConfig } from './client.js'
import * as items from './items.js'
import type { Item } from './items.js'
import * as keys from './keys.js'

/**
 * Cuánto puede quedar un aviso reservado sin enviarse antes de que otro intento lo retome. Tiene que
 * superar el timeout de `λ notifier` (30 s), para no retomar uno que todavía se está enviando.
 */
export const NOTIFICATION_LEASE_SECONDS = 120

/**
 * Intentos de envío de un mismo aviso, contando los que murieron sin informar. Pasado el tope, un
 * aviso que falla siempre deja de reintentarse: sin tope, cada evento nuevo de la cola volvería a
 * intentar un email que nunca va a salir, y cada intento es una invocación que se paga.
 */
export const NOTIFICATION_MAX_ATTEMPTS = 5

export interface QueueListing {
  queueId: string
  name: string
  status: QueueStatus
  archivedAt: string | null
}

export class DirectoryStore {
  constructor(private readonly table: TableConfig) {}

  /** Crea un establecimiento y deja a quien lo creó como dueño, en una sola transacción. */
  async createEstablishment(
    establishment: Establishment,
    ownerId: string,
    profile: { email?: string; displayName?: string } = {},
  ): Promise<Membership> {
    const membership: Membership = {
      userId: ownerId,
      establishmentId: establishment.id,
      role: 'OWNER',
      createdAt: establishment.createdAt,
      ...profile,
    }
    const [byUser, byEstablishment] = items.membershipItems(membership)
    await this.table.documents.send(
      new TransactWriteCommand({
        TransactItems: [items.establishmentItem(establishment), byUser, byEstablishment].map((Item) => ({
          Put: { TableName: this.table.tableName, Item, ConditionExpression: 'attribute_not_exists(PK)' },
        })),
      }),
    )
    return membership
  }

  /** Cambia el nombre o la zona horaria. Falla si el establecimiento no existe. */
  async updateEstablishment(establishment: Establishment): Promise<void> {
    await this.table.documents.send(
      new PutCommand({
        TableName: this.table.tableName,
        Item: items.establishmentItem(establishment),
        ConditionExpression: 'attribute_exists(PK)',
      }),
    )
  }

  async establishment(establishmentId: string): Promise<Establishment | null> {
    const item = await this.get(keys.establishmentPk(establishmentId), keys.ESTABLISHMENT_META_SK)
    return item ? items.strip<Establishment>(item) : null
  }

  /** Alta o cambio de rol de un miembro. Las dos copias se escriben juntas. */
  async putMembership(membership: Membership): Promise<void> {
    await this.table.documents.send(
      new TransactWriteCommand({
        TransactItems: items.membershipItems(membership).map((Item) => ({ Put: { TableName: this.table.tableName, Item } })),
      }),
    )
  }

  async removeMembership(userId: string, establishmentId: string): Promise<void> {
    await this.table.documents.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: this.table.tableName, Key: { PK: keys.userPk(userId), SK: keys.membershipSk(establishmentId) } } },
          { Delete: { TableName: this.table.tableName, Key: { PK: keys.establishmentPk(establishmentId), SK: keys.memberSk(userId) } } },
        ],
      }),
    )
  }

  /**
   * La membresía se lee en cada request, con lectura fuerte, y no viaja en el token: sacar a alguien
   * de un local tiene efecto en su próximo request, no en su próximo login.
   */
  async membership(userId: string, establishmentId: string): Promise<Membership | null> {
    const item = await this.get(keys.userPk(userId), keys.membershipSk(establishmentId))
    return item ? items.strip<Membership>(item) : null
  }

  /** Exige que el usuario sea miembro del local, y dueño si se pide. */
  async requireMember(userId: string, establishmentId: string, role?: MembershipRole): Promise<Membership> {
    const membership = await this.membership(userId, establishmentId)
    if (!membership) throw forbidden('NOT_A_MEMBER', 'You are not a member of this establishment')
    if (role === 'OWNER' && membership.role !== 'OWNER') {
      throw forbidden('OWNER_ONLY', 'Only an owner can do this')
    }
    return membership
  }

  async membershipsOf(userId: string): Promise<Membership[]> {
    return (await this.queryPrefix(keys.userPk(userId), 'EST#')).map((item) => items.strip<Membership>(item))
  }

  async membersOf(establishmentId: string): Promise<Membership[]> {
    return (await this.queryPrefix(keys.establishmentPk(establishmentId), 'MEMBER#')).map((item) => items.strip<Membership>(item))
  }

  async queuesOf(establishmentId: string): Promise<QueueListing[]> {
    return (await this.queryPrefix(keys.establishmentPk(establishmentId), 'QUEUE#')).map((item) => ({
      queueId: String(item['queueId']),
      name: String(item['name']),
      status: item['status'] as QueueStatus,
      archivedAt: (item['archivedAt'] as string | null) ?? null,
    }))
  }

  /**
   * Reserva un aviso antes de enviarlo. Pasa si nunca se intentó, si el intento anterior falló, o si
   * quedó PENDING más de `leaseSeconds`: eso significa que la Lambda que lo reservó murió antes de
   * enviarlo, y sin este caso el aviso no saldría nunca (el mismo defecto que tenía `retryFailed` en la versión Java).
   *
   * Cada reserva cuenta como un intento, porque un intento que muere sin informar también es un
   * intento. Devuelve false si ya se envió o si agotó `maxAttempts`.
   *
   * Es un Update y no un Put: un Put reescribiría el ítem entero y el contador volvería a cero en
   * cada reserva.
   */
  async claimNotification(
    record: NotificationRecord,
    now = new Date(),
    leaseSeconds = NOTIFICATION_LEASE_SECONDS,
    maxAttempts = NOTIFICATION_MAX_ATTEMPTS,
  ): Promise<boolean> {
    try {
      await this.table.documents.send(
        new UpdateCommand({
          TableName: this.table.tableName,
          Key: { PK: keys.entryPk(record.entryId), SK: keys.notificationSk(record.type, record.cycle) },
          UpdateExpression: [
            'SET #kind = :kind, #entryId = :entryId, #type = :type, #cycle = :cycle, #status = :pending,',
            '#channel = :channel, #destination = :destination, #claimedAt = :now,',
            '#createdAt = if_not_exists(#createdAt, :createdAt),',
            '#sentAt = if_not_exists(#sentAt, :null), #failureReason = if_not_exists(#failureReason, :null),',
            '#subject = :subject',
            'ADD #attempts :one',
          ].join(' '),
          ConditionExpression: [
            '(attribute_not_exists(PK) OR #status = :failed OR (#status = :pending AND #claimedAt < :staleBefore))',
            'AND (attribute_not_exists(#attempts) OR #attempts < :maxAttempts)',
          ].join(' '),
          ExpressionAttributeNames: {
            '#kind': 'kind',
            '#entryId': 'entryId',
            '#type': 'type',
            '#cycle': 'cycle',
            '#status': 'status',
            '#channel': 'channel',
            '#destination': 'destination',
            '#claimedAt': 'claimedAt',
            '#createdAt': 'createdAt',
            '#sentAt': 'sentAt',
            '#failureReason': 'failureReason',
            '#attempts': 'attempts',
            '#subject': 'subject',
          },
          ExpressionAttributeValues: {
            ':kind': 'NOTIFICATION',
            ':entryId': record.entryId,
            ':type': record.type,
            ':cycle': record.cycle,
            ':pending': 'PENDING',
            ':failed': 'FAILED',
            ':channel': record.channel,
            ':destination': record.destination,
            ':now': now.toISOString(),
            ':createdAt': record.createdAt,
            ':subject': record.subject ?? record.type,
            ':null': null,
            ':one': 1,
            ':staleBefore': new Date(now.getTime() - leaseSeconds * 1000).toISOString(),
            ':maxAttempts': maxAttempts,
          },
        }),
      )
      return true
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false
      throw error
    }
  }

  /** Registra el resultado del intento. El intento ya lo contó `claimNotification`. */
  async markNotification(
    entryId: string,
    type: NotificationRecord['type'],
    cycle: number,
    outcome:
      | { status: 'SENT'; at: string; channel?: NotificationRecord['channel'] }
      | { status: 'FAILED'; reason: string },
  ): Promise<void> {
    await this.table.documents.send(
      new UpdateCommand({
        TableName: this.table.tableName,
        Key: { PK: keys.entryPk(entryId), SK: keys.notificationSk(type, cycle) },
        UpdateExpression:
          outcome.status === 'SENT'
            ? 'SET #status = :status, sentAt = :at, failureReason = :none, channel = :channel'
            : 'SET #status = :status, failureReason = :reason',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues:
          outcome.status === 'SENT'
            ? { ':status': 'SENT', ':at': outcome.at, ':none': null, ':channel': outcome.channel ?? 'EMAIL' }
            : { ':status': 'FAILED', ':reason': outcome.reason },
      }),
    )
  }

  /** Emite un ticket de WebSocket para un miembro y una cola. Vence en `ttlSeconds`. */
  async issueWsTicket(grant: { userId: string; queueId: string }, now = new Date(), ttlSeconds = 60): Promise<{ ticket: string; expiresAt: string }> {
    const ticket = randomUUID()
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString()
    await this.table.documents.send(
      new PutCommand({
        TableName: this.table.tableName,
        Item: {
          PK: keys.wsTicketPk(ticket),
          SK: keys.WS_TICKET_SK,
          kind: 'WS_TICKET',
          ...grant,
          expiresAt,
          // El TTL de DynamoDB puede tardar en borrar: la vigencia la decide `expiresAt`.
          ttl: keys.epochSeconds(now) + ttlSeconds,
        },
      }),
    )
    return { ticket, expiresAt }
  }

  /**
   * Usa un ticket de WebSocket: lo borra y devuelve a quién y a qué cola autoriza. Un borrado
   * condicional hace que sirva una sola vez, aunque dos conexiones lo presenten a la vez.
   */
  async consumeWsTicket(ticket: string, now = new Date()): Promise<{ userId: string; queueId: string } | null> {
    try {
      const { Attributes } = await this.table.documents.send(
        new DeleteCommand({
          TableName: this.table.tableName,
          Key: { PK: keys.wsTicketPk(ticket), SK: keys.WS_TICKET_SK },
          ConditionExpression: 'attribute_exists(PK) AND expiresAt > :now',
          ExpressionAttributeValues: { ':now': now.toISOString() },
          ReturnValues: 'ALL_OLD',
        }),
      )
      return Attributes ? { userId: String(Attributes['userId']), queueId: String(Attributes['queueId']) } : null
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return null
      throw error
    }
  }

  async notificationsOf(entryId: string): Promise<NotificationRecord[]> {
    return (await this.queryPrefix(keys.entryPk(entryId), 'NOTIF#')).map((item) => items.strip<NotificationRecord>(item))
  }

  /**
   * Cuenta un request de esta IP en el minuto actual. Devuelve false si ya pasó el límite.
   * El ítem vence solo a los dos minutos.
   */
  async allowRequest(ip: string, limitPerMinute: number, now = new Date()): Promise<boolean> {
    const minute = now.toISOString().slice(0, 16)
    try {
      await this.table.documents.send(
        new UpdateCommand({
          TableName: this.table.tableName,
          Key: { PK: keys.ratePk(ip, minute), SK: keys.RATE_SK },
          UpdateExpression: 'ADD n :one SET #ttl = if_not_exists(#ttl, :ttl)',
          ConditionExpression: 'attribute_not_exists(n) OR n < :limit',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':limit': limitPerMinute, ':ttl': keys.epochSeconds(now) + 120 },
        }),
      )
      return true
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false
      throw error
    }
  }

  private async get(pk: string, sk: string): Promise<Item | null> {
    const { Item } = await this.table.documents.send(
      new GetCommand({ TableName: this.table.tableName, Key: { PK: pk, SK: sk }, ConsistentRead: true }),
    )
    return Item ?? null
  }

  private async queryPrefix(pk: string, prefix: string): Promise<Item[]> {
    const found: Item[] = []
    let start: Record<string, unknown> | undefined
    do {
      const page = await this.table.documents.send(
        new QueryCommand({
          TableName: this.table.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix },
          ConsistentRead: true,
          ExclusiveStartKey: start,
        }),
      )
      found.push(...((page.Items ?? []) as Item[]))
      start = page.LastEvaluatedKey
    } while (start)
    return found
  }
}
