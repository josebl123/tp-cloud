// λ public: lo que usan los clientes, sin sesión. El ticket token es la credencial: quien lo tiene ve
// su lugar en la fila y nada más.
//
//   GET    /api/v1/health
//   GET    /api/v1/public/queues/{queueId}
//   GET    /api/v1/public/queues/{queueId}/availability?partySize=
//   GET    /api/v1/public/queues/{queueId}/qr?size=
//   POST   /api/v1/public/queues/{queueId}/entries
//   GET    /api/v1/public/tickets/{ticketToken}
//   DELETE /api/v1/public/tickets/{ticketToken}
//   GET    /api/v1/public/tickets/{ticketToken}/notifications

import QRCode from 'qrcode'
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { JoinCommand } from '../domain/entries.js'
import { join, leave } from '../domain/entries.js'
import { notFound } from '../domain/errors.js'
import type { QueueState } from '../domain/state.js'
import { snapshot, ticketView } from '../domain/views.js'
import { HttpError, binary, created, json, ok, router } from '../http/api.js'
import type { Request, Routes } from '../http/api.js'
import type { TableConfig } from '../persistence/client.js'
import { createTableConfig } from '../persistence/client.js'
import { DirectoryStore } from '../persistence/directory-store.js'
import { QueueStore } from '../persistence/queue-store.js'
import {
  availabilityView,
  joinUrl,
  notificationView,
  parsePartySize,
  publicQueueView,
  queueSummary,
  ticketUrl,
} from '../api/views.js'

export interface PublicDependencies {
  table: TableConfig
  queues: QueueStore
  directory: DirectoryStore
  /** Uniones por IP y por minuto antes de responder 429. */
  joinsPerMinute: number
}

const QR_SIZES = { min: 128, max: 1024, fallback: 512 }

export function publicRoutes(deps: PublicDependencies): Routes {
  const { queues, directory } = deps

  const establishmentName = async (state: QueueState) =>
    (await directory.establishment(state.queue.establishmentId))?.name ?? ''

  /** Una cola archivada no existe para los clientes: su QR viejo no tiene que llevar a ningún lado. */
  const requireListed = (state: QueueState) => {
    if (state.queue.archivedAt !== null) throw notFound('QUEUE_ARCHIVED', 'This queue is archived')
    return state
  }

  const ticketResponse = async (request: Request, state: QueueState, entryId: string) => {
    const entry = state.entries.find((candidate) => candidate.id === entryId)
    if (!entry) throw notFound('TICKET_NOT_FOUND', 'Ticket not found')
    const summary = queueSummary(state.queue, await establishmentName(state))
    return ticketView(snapshot(state), entry, summary, ticketUrl(request.baseUrl, entry.ticketToken), request.now)
  }

  const resolveTicket = async (request: Request) => {
    const ticket = await queues.resolveTicket(request.param('ticketToken'))
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Ticket not found')
    return ticket
  }

  return {
    /** Prueba de humo: la función escribe y lee la tabla. Es lo que consulta el pipeline. */
    'GET /api/v1/health': async (request) => {
      const key = { PK: 'HEALTH', SK: 'PING' }
      const at = request.now.toISOString()
      const { documents, tableName } = deps.table
      await documents.send(
        new PutCommand({ TableName: tableName, Item: { ...key, at, ttl: Math.floor(request.now.getTime() / 1000) + 3600 } }),
      )
      const read = await documents.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }))
      if (read.Item?.['at'] !== at) throw new HttpError(503, 'UNHEALTHY', 'The table did not return what was written')
      return ok({ status: 'ok', table: tableName, wroteAt: at })
    },

    // La página de ingreso se refresca sola cada 15 s: lectura eventualmente consistente, a mitad de
    // costo. Unos milisegundos de atraso en "cuántos esperan" no cambian nada.
    'GET /api/v1/public/queues/{queueId}': async (request) => {
      const state = requireListed(await queues.read(request.param('queueId'), { consistent: false }))
      return ok(publicQueueView(state, await establishmentName(state)))
    },

    'GET /api/v1/public/queues/{queueId}/availability': async (request) => {
      const partySize = parsePartySize(request.query('partySize'))
      const state = requireListed(await queues.read(request.param('queueId'), { consistent: false }))
      return ok(availabilityView(state, partySize))
    },

    'GET /api/v1/public/queues/{queueId}/qr': async (request) => {
      const queueId = request.param('queueId')
      // El QR solo lleva la URL, pero confirmar que la cola existe evita imprimir un cartel muerto.
      requireListed(await queues.read(queueId, { consistent: false }))
      const requested = Number(request.query('size') ?? QR_SIZES.fallback)
      const size = Number.isFinite(requested)
        ? Math.min(QR_SIZES.max, Math.max(QR_SIZES.min, Math.round(requested)))
        : QR_SIZES.fallback
      const png = await QRCode.toBuffer(joinUrl(request.baseUrl, queueId), { type: 'png', width: size, margin: 2 })
      return binary('image/png', png, 'public, max-age=3600')
    },

    'POST /api/v1/public/queues/{queueId}/entries': async (request) => {
      if (!(await directory.allowRequest(request.sourceIp, deps.joinsPerMinute, request.now))) {
        throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many attempts from this connection. Please wait a minute.')
      }
      const queueId = request.param('queueId')
      const command = request.body<JoinCommand>()
      const { result: entry, state } = await queues.mutate(queueId, (session) => join(session, command))
      const view = await ticketResponse(request, state, entry.id)
      return created(view, `${request.baseUrl}/api/v1/public/tickets/${entry.ticketToken}`)
    },

    // El ticket se pide justo después de unirse: siempre con lectura fuerte.
    'GET /api/v1/public/tickets/{ticketToken}': async (request) => {
      const { queueId, entryId } = await resolveTicket(request)
      const state = await queues.read(queueId, { entryIds: [entryId] })
      return ok(await ticketResponse(request, state, entryId))
    },

    'DELETE /api/v1/public/tickets/{ticketToken}': async (request) => {
      const { queueId, entryId } = await resolveTicket(request)
      const { state } = await queues.mutate(queueId, (session) => leave(session, entryId), { entryIds: [entryId] })
      return ok(await ticketResponse(request, state, entryId))
    },

    'GET /api/v1/public/tickets/{ticketToken}/notifications': async (request) => {
      const { entryId } = await resolveTicket(request)
      return json(200, (await directory.notificationsOf(entryId)).map(notificationView))
    },
  }
}

function defaultDependencies(): PublicDependencies {
  const table = createTableConfig()
  return {
    table,
    queues: new QueueStore(table),
    directory: new DirectoryStore(table),
    joinsPerMinute: Number(process.env.JOINS_PER_MINUTE ?? 20),
  }
}

// Se arma en la primera invocación y se reutiliza mientras la instancia siga viva. No al importar:
// así los tests pueden usar `publicRoutes` sin variables de entorno.
let cached: ReturnType<typeof router> | undefined
export const handler: ReturnType<typeof router> = (event) => (cached ??= router(publicRoutes(defaultDependencies())))(event)
