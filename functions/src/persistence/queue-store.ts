// Leer una cola y escribir sus cambios con control optimista.
//
// Hoy cada mutación tomaba `SELECT … FOR UPDATE` sobre la fila de la cola. DynamoDB no tiene locks:
// el equivalente es leer `META.version`, decidir en memoria y escribir todo en una transacción que
// solo pasa si la versión sigue siendo la misma. Si otro escritor ganó, se relee y se vuelve a
// decidir. Las transacciones de DynamoDB son serializables entre sí, así que dos personas del staff
// que llaman a la vez producen exactamente un llamado cada una, sobre personas distintas.

import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb'
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { randomUUID } from 'node:crypto'
import { conflict, notFound } from '../domain/errors.js'
import { expireDue, hasDueGrace } from '../domain/grace.js'
import type { QueueState } from '../domain/state.js'
import { Session } from '../domain/state.js'
import type { Entry, Lane, Queue } from '../domain/types.js'
import type { TableConfig } from './client.js'
import * as items from './items.js'
import type { Item } from './items.js'
import * as keys from './keys.js'

/** El máximo de una transacción de DynamoDB. */
export const MAX_TRANSACTION_ITEMS = 100

/** Cuántas sesiones de vencimiento corre una lectura antes de responder con lo que haya. */
const MAX_EXPIRATION_ROUNDS = 5
/**
 * Intentos ante un conflicto de versión. Con 5, una ráfaga de escaneos del QR sobre la misma cola
 * podía agotarlos y devolverle 409 a alguien que solo quería anotarse; 8 con backoff de hasta
 * 500 ms sigue entrando holgado en el timeout de la función.
 */
export const DEFAULT_MAX_ATTEMPTS = 8
/**
 * Relecturas de una cola cuya versión cambió mientras se leía. Cada una dura lo que tres consultas,
 * así que hace falta un ritmo de escrituras sostenido muy por encima del de una fila para agotarlas.
 */
export const MAX_SNAPSHOT_ATTEMPTS = 5

type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number]

export interface MutateOptions {
  /** Entradas terminadas que la operación necesita leer (por ejemplo, para volver a ponerlas). */
  entryIds?: readonly string[]
  maxAttempts?: number
  now?: () => Date
  newId?: () => string
  /** Solo para tests: corre entre la lectura y la escritura de cada intento. */
  afterLoad?: (attempt: number) => Promise<void>
}

export interface MutationResult<R> {
  result: R
  state: QueueState
  session: Session
  /** Cuántas veces hubo que releer por un conflicto de versión. */
  retries: number
}

/** La versión de otra escritura ganó: hay que releer. */
class VersionConflict extends Error {}

export class QueueStore {
  constructor(private readonly table: TableConfig) {}

  /**
   * La cola con sus carriles y sus entradas activas. Por defecto con lecturas fuertemente
   * consistentes: después de escribir, quien lee ve lo que se escribió (un cliente que se acaba de
   * unir se encuentra). Las mutaciones siempre leen así.
   *
   * `consistent: false` cuesta la mitad y sirve para lo que se consulta seguido y tolera un atraso de
   * milisegundos, como la vista pública de la página de ingreso, que se refresca cada 15 s. El ticket
   * de un cliente no: se lo pide justo después de unirse.
   */
  async load(queueId: string, entryIds: readonly string[] = [], options: { consistent?: boolean } = {}): Promise<QueueState> {
    const consistent = options.consistent ?? true
    const pk = keys.queuePk(queueId)

    for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt++) {
      // `LANE#…` < `META` en orden de bytes: un solo rango trae los carriles y la configuración.
      const config = await this.queryAll(
        {
          KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
          ExpressionAttributeValues: { ':pk': pk, ':from': 'LANE#', ':to': keys.QUEUE_META_SK },
        },
        consistent,
      )
      const metaItem = config.find((item) => item['SK'] === keys.QUEUE_META_SK)
      if (!metaItem) throw notFound('QUEUE_NOT_FOUND', `Queue ${queueId} was not found`)

      const [inService, waiting] = await Promise.all([
        this.queryPrefix(pk, keys.IN_SERVICE_PREFIX, consistent),
        this.queryPrefix(pk, keys.WAITING_PREFIX, consistent),
      ])

      // Tres consultas no son una foto: si otra transacción se confirmó entre ellas, cada grupo de
      // entradas puede reflejar un momento distinto (alguien recién llamado no aparece ni en la fila
      // ni entre los llamados). El control de versión no lo detecta si la versión que se leyó ya es
      // la nueva. Toda transacción sobre la cola sube `version`, así que si sigue igual después de
      // leer las entradas, nada se confirmó en el medio y la foto es de un único instante.
      //
      // Con lecturas eventualmente consistentes no hay foto posible: son para vistas que toleran
      // un atraso, y ninguna mutación las usa.
      if (consistent && (await this.versionOf(queueId)) !== metaItem['version']) continue

      return this.assemble(queueId, config, metaItem, [...inService, ...waiting], entryIds)
    }
    throw conflict('CONCURRENT_MODIFICATION', 'The queue changed while it was being read. Please try again.')
  }

  private async assemble(
    queueId: string,
    config: Item[],
    metaItem: Item,
    activeItems: Item[],
    entryIds: readonly string[],
  ): Promise<QueueState> {
    const entries = activeItems.map((item) => items.strip<Entry>(item))
    const missing = entryIds.filter((id) => !entries.some((entry) => entry.id === id))
    for (const entry of await Promise.all(missing.map((id) => this.loadEntryById(id)))) {
      if (entry && entry.queueId === queueId) entries.push(entry)
    }

    return {
      queue: items.strip<Queue>(metaItem),
      lanes: config.filter((item) => item['kind'] === 'LANE').map((item) => items.strip<Lane>(item)),
      entries,
    }
  }

  /**
   * Lee la cola para responder una consulta. Si encuentra una gracia vencida la aplica antes, así
   * nadie ve un llamado que el reloj ya invalidó; si no, no escribe nada.
   */
  async read(
    queueId: string,
    options: Pick<MutateOptions, 'entryIds' | 'now'> & { consistent?: boolean } = {},
  ): Promise<QueueState> {
    const now = options.now ?? (() => new Date())
    let state = await this.load(queueId, options.entryIds, { consistent: options.consistent ?? true })
    // Cada sesión vence una cantidad acotada: con muchos llamados vencidos hacen falta varias.
    for (let round = 0; round < MAX_EXPIRATION_ROUNDS && hasDueGrace(state.entries, now()); round++) {
      // Si otro disparador ya la aplicó, el reintento relee y no encuentra nada: no es un error.
      ;({ state } = await this.mutate(queueId, (session) => expireDue(session), {
        ...(options.entryIds ? { entryIds: options.entryIds } : {}),
        now,
      }))
    }
    return state
  }

  /**
   * Corre una operación del dominio sobre la cola y escribe sus cambios en una sola transacción.
   * La operación tiene que ser pura sobre la sesión: ante un conflicto se vuelve a correr desde cero.
   */
  async mutate<R>(queueId: string, operation: (session: Session) => R, options: MutateOptions = {}): Promise<MutationResult<R>> {
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    const now = options.now ?? (() => new Date())
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const state = await this.load(queueId, options.entryIds)
      await options.afterLoad?.(attempt)
      const session = new Session(state, now(), options.newId)
      const result = operation(session)
      try {
        await this.commit(session)
        return { result, state: session.state, session, retries: attempt }
      } catch (error) {
        if (!(error instanceof VersionConflict)) throw error
        await backoff(attempt)
      }
    }
    throw conflict('CONCURRENT_MODIFICATION', 'The queue changed while this operation ran. Please try again.')
  }

  /** Crea una cola nueva: su configuración, sus carriles, la fila del listado y el evento. */
  async create(state: QueueState, record: (session: Session) => void, now = new Date()): Promise<Session> {
    const session = new Session(state, now)
    record(session)
    session.touchQueue()
    for (const lane of state.lanes) session.touchLane(lane)
    await this.commit(session, { creating: true })
    return session
  }

  /**
   * Arma la transacción con todo lo que la sesión tocó, condicionada a la versión leída.
   *
   * Cada entrada que cambió de estado se mueve: se borra su SK viejo y se escribe el nuevo, y se
   * actualiza su referencia `ENTRY#…/REF` para que se la pueda encontrar por id.
   */
  async commit(session: Session, options: { creating?: boolean } = {}): Promise<void> {
    if (!session.hasChanges) return
    const { tableName } = this.table
    const queue = session.state.queue
    const readVersion = queue.version
    const version = options.creating ? 0 : readVersion + 1
    const now = session.now

    const writes: TransactItem[] = []
    const put = (item: Item, condition?: string, values?: Record<string, unknown>): void => {
      writes.push({
        Put: {
          TableName: tableName,
          Item: item,
          ...(condition ? { ConditionExpression: condition } : {}),
          ...(values ? { ExpressionAttributeValues: values } : {}),
        },
      })
    }

    // La versión es lo que serializa a los escritores de una cola. Va primera: si una transacción
    // se cancela, su motivo en la posición 0 dice si fue por esto.
    queue.version = version
    if (options.creating) put(items.queueItem(queue), 'attribute_not_exists(PK)')
    else put(items.queueItem(queue), 'version = :read', { ':read': readVersion })

    for (const entryId of session.touchedEntries) {
      const entry = session.findEntry(entryId)
      if (!entry) continue
      const before = session.original.get(entryId)
      const sk = keys.entrySk(entry)
      if (!before) {
        put(items.entryItem(entry), 'attribute_not_exists(PK)')
        put(items.ticketItem(entry), 'attribute_not_exists(PK)')
        put(items.entryRefItem(entry), 'attribute_not_exists(PK)')
        continue
      }
      const previousSk = keys.entrySk(before)
      if (previousSk !== sk) {
        writes.push({ Delete: { TableName: tableName, Key: { PK: keys.queuePk(entry.queueId), SK: previousSk } } })
        writes.push({
          Update: {
            TableName: tableName,
            Key: { PK: keys.entryPk(entry.id), SK: keys.ENTRY_REF_SK },
            UpdateExpression: 'SET sk = :sk',
            ExpressionAttributeValues: { ':sk': sk },
          },
        })
      }
      // Si se movió, su SK nuevo no puede pisar a otra entrada: el dominio ya evita claves repetidas,
      // y esta condición garantiza que un error ahí falle en lugar de borrar a alguien de la fila.
      if (previousSk !== sk) put(items.entryItem(entry), 'attribute_not_exists(PK)')
      else put(items.entryItem(entry))
    }

    for (const laneId of session.touchedLanes) {
      const lane = session.state.lanes.find((candidate) => candidate.id === laneId)
      if (lane) put(items.laneItem(lane))
    }

    // La fila del listado del establecimiento sigue al nombre y al estado de la cola, y solo se
    // reescribe cuando alguno de los dos cambió.
    const listed = session.originalQueue
    if (
      options.creating ||
      listed.name !== queue.name ||
      listed.status !== queue.status ||
      listed.archivedAt !== queue.archivedAt
    ) {
      put(items.establishmentQueueItem(queue))
    }

    session.events.forEach((event, index) => put(items.eventItem(event, version, index, now), 'attribute_not_exists(PK)'))

    if (writes.length > MAX_TRANSACTION_ITEMS) {
      queue.version = readVersion
      throw new RangeError(`La operación escribe ${writes.length} ítems; una transacción admite ${MAX_TRANSACTION_ITEMS}`)
    }

    try {
      await this.table.documents.send(
        new TransactWriteCommand({ TransactItems: writes, ClientRequestToken: randomUUID() }),
      )
    } catch (error) {
      queue.version = readVersion
      if (error instanceof TransactionCanceledException) {
        const reasons = error.CancellationReasons ?? []
        if (reasons[0]?.Code === 'ConditionalCheckFailed') {
          if (options.creating) throw conflict('QUEUE_EXISTS', `Queue ${queue.id} already exists`)
          throw new VersionConflict()
        }
        // Otra transacción estaba tocando alguno de los mismos ítems en ese instante: es el mismo
        // caso que perder la versión, y se resuelve igual.
        if (reasons.some((reason) => reason.Code === 'TransactionConflict')) throw new VersionConflict()
      }
      throw error
    }
  }

  /** Una entrada por id, esté en el estado que esté. */
  async loadEntryById(entryId: string): Promise<Entry | null> {
    const ref = await this.get(keys.entryPk(entryId), keys.ENTRY_REF_SK)
    if (!ref) return null
    const item = await this.get(keys.queuePk(String(ref['queueId'])), String(ref['sk']))
    return item ? items.strip<Entry>(item) : null
  }

  /**
   * El establecimiento de una cola, sin leer la cola entera. Nunca cambia, así que alcanza para
   * autorizar antes de mutar.
   */
  async establishmentOf(queueId: string): Promise<string> {
    const { Item } = await this.table.documents.send(
      new GetCommand({
        TableName: this.table.tableName,
        Key: { PK: keys.queuePk(queueId), SK: keys.QUEUE_META_SK },
        ProjectionExpression: 'establishmentId',
      }),
    )
    if (!Item) throw notFound('QUEUE_NOT_FOUND', `Queue ${queueId} was not found`)
    return String(Item['establishmentId'])
  }

  /** La cola a la que pertenece una entrada. Es inmutable, así que no hace falta leer la entrada. */
  async queueIdOfEntry(entryId: string): Promise<string | null> {
    const ref = await this.get(keys.entryPk(entryId), keys.ENTRY_REF_SK)
    return ref ? String(ref['queueId']) : null
  }

  /** Resuelve el ticket token de un cliente a su cola y su entrada. */
  async resolveTicket(token: string): Promise<{ queueId: string; entryId: string } | null> {
    const ticket = await this.get(keys.ticketPk(token), keys.TICKET_SK)
    return ticket ? { queueId: String(ticket['queueId']), entryId: String(ticket['entryId']) } : null
  }

  /** Las entradas que terminaron en [from, to), para las métricas. */
  async finishedBetween(queueId: string, from: string, to: string): Promise<Entry[]> {
    const found = await this.queryAll({
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
      ExpressionAttributeValues: { ':pk': keys.queuePk(queueId), ':from': keys.finishedSk(from), ':to': keys.finishedSk(to) },
    })
    return found.map((item) => items.strip<Entry>(item)).filter((entry) => (entry.finishedAt ?? '') < to)
  }

  /** Los últimos eventos de una cola, del más nuevo al más viejo: el historial del panel. */
  async recentEvents(queueId: string, limit: number): Promise<Item[]> {
    const { Items } = await this.table.documents.send(
      new QueryCommand({
        TableName: this.table.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': keys.eventsPk(queueId) },
        ScanIndexForward: false,
        Limit: limit,
      }),
    )
    return (Items ?? []) as Item[]
  }

  /**
   * Los eventos de una cola desde un instante, del más nuevo al más viejo.
   *
   * Los eventos se ordenan por versión de la cola, que crece con el tiempo: se recorren hacia atrás y
   * se corta en el primero anterior a `since`. Así el historial de una entrada lee solo lo que pasó
   * en la cola desde que esa persona se unió, y no los 30 días que guarda la tabla: en una cola con
   * movimiento eso eran decenas de megabytes por consulta.
   */
  async eventsSince(queueId: string, since: string): Promise<Item[]> {
    const found: Item[] = []
    let start: Record<string, unknown> | undefined
    do {
      const page = await this.table.documents.send(
        new QueryCommand({
          TableName: this.table.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': keys.eventsPk(queueId) },
          ScanIndexForward: false,
          Limit: 100,
          ExclusiveStartKey: start,
        }),
      )
      for (const item of (page.Items ?? []) as Item[]) {
        if (String(item['occurredAt'] ?? '') < since) return found
        found.push(item)
      }
      start = page.LastEvaluatedKey
    } while (start)
    return found
  }

  /** Los eventos de una cola, del más viejo al más nuevo. */
  async events(queueId: string): Promise<Item[]> {
    return this.queryAll({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': keys.eventsPk(queueId) },
    })
  }

  /** La versión actual de una cola, con lectura fuerte y sin traer el resto de la configuración. */
  private async versionOf(queueId: string): Promise<unknown> {
    const { Item } = await this.table.documents.send(
      new GetCommand({
        TableName: this.table.tableName,
        Key: { PK: keys.queuePk(queueId), SK: keys.QUEUE_META_SK },
        ConsistentRead: true,
        ProjectionExpression: 'version',
      }),
    )
    return Item?.['version']
  }

  private async get(pk: string, sk: string): Promise<Item | null> {
    const { Item } = await this.table.documents.send(
      new GetCommand({ TableName: this.table.tableName, Key: { PK: pk, SK: sk }, ConsistentRead: true }),
    )
    return Item ?? null
  }

  private queryPrefix(pk: string, prefix: string, consistent = true): Promise<Item[]> {
    return this.queryAll(
      {
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix },
      },
      consistent,
    )
  }

  private async queryAll(
    input: { KeyConditionExpression: string; ExpressionAttributeValues: Record<string, unknown> },
    consistent = true,
  ) {
    const found: Item[] = []
    let start: Record<string, unknown> | undefined
    do {
      const page = await this.table.documents.send(
        new QueryCommand({ TableName: this.table.tableName, ConsistentRead: consistent, ExclusiveStartKey: start, ...input }),
      )
      found.push(...((page.Items ?? []) as Item[]))
      start = page.LastEvaluatedKey
    } while (start)
    return found
  }
}

/** Backoff exponencial con jitter completo: dos escritores que chocan no vuelven a chocar igual. */
function backoff(attempt: number): Promise<void> {
  const cap = Math.min(500, 20 * 2 ** attempt)
  return new Promise((resolve) => setTimeout(resolve, Math.random() * cap))
}
