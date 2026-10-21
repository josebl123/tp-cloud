// λ staff: todo el panel. API Gateway ya validó el token de Cognito antes de invocar esta función;
// acá se decide qué puede hacer ese usuario.
//
// La autorización es siempre contra el establecimiento de la cola LEÍDA (o de la entrada leída),
// nunca contra un id que mande el cliente: así nadie opera una cola ajena pasando el id de su propio
// local. La membresía se lee en cada pedido y no viaja en el token: sacar a alguien tiene efecto en
// su próximo pedido, no en su próximo login.

import { randomUUID } from 'node:crypto'
import { call, callNext, transition } from '../domain/entries.js'
import { notFound } from '../domain/errors.js'
import { computeMetrics, DEFAULT_TIMEZONE, windowFor } from '../domain/metrics.js'
import type { LaneSettings } from '../domain/queues.js'
import { archiveQueue, changeStatus, createLane, newQueueState, retireLane, updateLane, updateQueue } from '../domain/queues.js'
import { staff } from '../domain/state.js'
import type { DomainEvent, Entry, EntryStatus, Establishment, MembershipRole, QueueStatus } from '../domain/types.js'
import { ENTRY_STATUSES, isActive } from '../domain/types.js'
import { entryView, snapshot } from '../domain/views.js'
import { badRequest, created, HttpError, json, noContent, ok, router } from '../http/api.js'
import type { Request, Routes } from '../http/api.js'
import * as items from '../persistence/items.js'
import { createTableConfig } from '../persistence/client.js'
import { DirectoryStore } from '../persistence/directory-store.js'
import { QueueStore } from '../persistence/queue-store.js'
import type { UserDirectory } from '../api/users.js'
import { CognitoUsers } from '../api/users.js'
import {
  boardView,
  establishmentView,
  eventView,
  laneView,
  liveLanes,
  memberView,
  metricsView,
  notificationView,
  parseRange,
  queueView,
  RANGE_DAYS,
} from '../api/views.js'
import { laneSettings, queueSettings, readEstablishmentInput, readMemberInput } from '../api/input.js'

export interface StaffDependencies {
  queues: QueueStore
  directory: DirectoryStore
  users: UserDirectory
  newId?: () => string
}

const QUEUE_STATUSES: readonly QueueStatus[] = ['OPEN', 'PAUSED', 'CLOSED']
const EVENT_LIMIT = { fallback: 50, max: 200 }

export function staffRoutes(deps: StaffDependencies): Routes {
  const { queues, directory, users } = deps
  const newId = deps.newId ?? randomUUID

  const requireMember = (request: Request, establishmentId: string, role?: MembershipRole) =>
    directory.requireMember(request.caller().sub, establishmentId, role)

  const requireEstablishment = async (establishmentId: string): Promise<Establishment> => {
    const establishment = await directory.establishment(establishmentId)
    if (!establishment) throw notFound('ESTABLISHMENT_NOT_FOUND', `Establishment ${establishmentId} was not found`)
    return establishment
  }

  const establishmentName = async (establishmentId: string) => (await directory.establishment(establishmentId))?.name ?? ''

  /** Autoriza sobre la cola y devuelve su establecimiento. La cola no cambia de dueño nunca. */
  const authorizeQueue = async (request: Request, queueId: string, role?: MembershipRole) => {
    const establishmentId = await queues.establishmentOf(queueId)
    await requireMember(request, establishmentId, role)
    return establishmentId
  }

  /** Una entrada se resuelve a su cola, y se autoriza sobre esa cola. */
  const authorizeEntry = async (request: Request, entryId: string) => {
    const queueId = await queues.queueIdOfEntry(entryId)
    if (!queueId) throw notFound('ENTRY_NOT_FOUND', `Entry ${entryId} was not found`)
    const establishmentId = await authorizeQueue(request, queueId)
    return { queueId, establishmentId }
  }

  const visibleQueue = async (request: Request, queueId: string) => {
    const establishmentId = await authorizeQueue(request, queueId)
    const state = await queues.read(queueId)
    if (state.queue.archivedAt !== null) throw notFound('QUEUE_ARCHIVED', 'This queue is archived')
    return { state, establishmentId }
  }

  const queueResponse = async (request: Request, queueId: string) => {
    const { state, establishmentId } = await visibleQueue(request, queueId)
    return queueView(state.queue, state.lanes, await establishmentName(establishmentId), request.baseUrl)
  }

  const entryResponse = (request: Request, state: Parameters<typeof snapshot>[0], entryId: string) => {
    const entry = state.entries.find((candidate) => candidate.id === entryId)
    if (!entry) throw notFound('ENTRY_NOT_FOUND', `Entry ${entryId} was not found`)
    return entryView(snapshot(state), entry, request.now)
  }

  const eventsOf = (found: Record<string, unknown>[]) => found.map((item) => eventView(items.strip<DomainEvent>(item)))

  return {
    // ----------------------------------------------------------------------------- sesión

    // El token ya trae el email y el nombre: Cognito solo aporta la fecha de alta. Si no responde
    // (o el rol del lab no puede consultarlo), la sesión no puede caerse por eso.
    'GET /api/v1/auth/me': async (request) => {
      const caller = request.caller()
      const fromToken = { id: caller.sub, email: caller.email, displayName: caller.name, createdAt: request.now.toISOString() }
      try {
        return ok((await users.get(caller.sub)) ?? fromToken)
      } catch (error) {
        console.warn('Cognito no respondió el perfil; se usa el del token', error)
        return ok(fromToken)
      }
    },

    // ----------------------------------------------------------------------------- establecimientos

    'GET /api/v1/establishments': async (request) => {
      const memberships = await directory.membershipsOf(request.caller().sub)
      const found = await Promise.all(
        memberships.map(async (membership) => {
          const establishment = await directory.establishment(membership.establishmentId)
          return establishment ? establishmentView(establishment, membership.role) : null
        }),
      )
      return ok(found.filter((view) => view !== null).sort((a, b) => a.name.localeCompare(b.name)))
    },

    'POST /api/v1/establishments': async (request) => {
      const caller = request.caller()
      const input = readEstablishmentInput(request.body(), { requireName: true })
      const establishment: Establishment = {
        id: newId(),
        name: input.name ?? '',
        timezone: input.timezone ?? DEFAULT_TIMEZONE,
        createdAt: request.now.toISOString(),
      }
      await directory.createEstablishment(establishment, caller.sub, { email: caller.email, displayName: caller.name })
      return created(establishmentView(establishment, 'OWNER'))
    },

    'GET /api/v1/establishments/{establishmentId}': async (request) => {
      const establishmentId = request.param('establishmentId')
      const membership = await requireMember(request, establishmentId)
      return ok(establishmentView(await requireEstablishment(establishmentId), membership.role))
    },

    'PATCH /api/v1/establishments/{establishmentId}': async (request) => {
      const establishmentId = request.param('establishmentId')
      await requireMember(request, establishmentId, 'OWNER')
      const input = readEstablishmentInput(request.body(), { requireName: false })
      const updated = { ...(await requireEstablishment(establishmentId)) }
      if (input.name !== undefined) updated.name = input.name
      if (input.timezone !== undefined) updated.timezone = input.timezone
      await directory.updateEstablishment(updated)
      return ok(establishmentView(updated, 'OWNER'))
    },

    'GET /api/v1/establishments/{establishmentId}/members': async (request) => {
      const establishmentId = request.param('establishmentId')
      await requireMember(request, establishmentId)
      return ok((await directory.membersOf(establishmentId)).map(memberView))
    },

    'POST /api/v1/establishments/{establishmentId}/members': async (request) => {
      const establishmentId = request.param('establishmentId')
      await requireMember(request, establishmentId, 'OWNER')
      const input = readMemberInput(request.body())

      let user = await users.findByEmail(input.email)
      // Con contraseña, el dueño cree que está creando la cuenta. Si ya existe la registró otra persona,
      // y agregarla en silencio le daría acceso al local a quien se adelantó a registrar ese mail.
      if (user && input.password) {
        throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Add it without a password.')
      }
      if (!user) {
        if (!input.password) throw notFound('USER_NOT_FOUND', 'No account uses this email. Send a password to create one.')
        user = await users.create({ email: input.email, password: input.password, displayName: input.displayName ?? input.email })
      }
      if (await directory.membership(user.id, establishmentId)) {
        throw new HttpError(409, 'ALREADY_A_MEMBER', 'This person already belongs to the establishment')
      }
      const membership = {
        userId: user.id,
        establishmentId,
        role: input.role,
        createdAt: request.now.toISOString(),
        email: user.email,
        displayName: user.displayName,
      }
      await directory.putMembership(membership)
      return created(memberView(membership))
    },

    'GET /api/v1/establishments/{establishmentId}/queues': async (request) => {
      const establishmentId = request.param('establishmentId')
      await requireMember(request, establishmentId)
      const name = await establishmentName(establishmentId)
      const listed = (await directory.queuesOf(establishmentId))
        .filter((queue) => queue.archivedAt === null)
        .sort((a, b) => a.name.localeCompare(b.name))
      const states = await Promise.all(listed.map((queue) => queues.read(queue.queueId, { consistent: false })))
      return ok(states.map((state) => queueView(state.queue, state.lanes, name, request.baseUrl)))
    },

    'POST /api/v1/establishments/{establishmentId}/queues': async (request) => {
      const establishmentId = request.param('establishmentId')
      await requireMember(request, establishmentId, 'OWNER')
      const settings = queueSettings(request.body(), { creating: true })
      const state = newQueueState(
        { queueId: newId(), laneId: newId() },
        establishmentId,
        { ...settings, name: settings.name ?? '' },
        request.now,
      )
      await queues.create(state, (session) => session.record('QUEUE_CREATED', staff(request.caller().sub), null), request.now)
      return created(queueView(state.queue, state.lanes, await establishmentName(establishmentId), request.baseUrl))
    },

    'GET /api/v1/establishments/{establishmentId}/metrics': async (request) => {
      const establishmentId = request.param('establishmentId')
      await requireMember(request, establishmentId)
      const range = parseRange(request.query('range'))
      const establishment = await requireEstablishment(establishmentId)
      const window = windowFor(establishment.timezone, RANGE_DAYS[range], request.now)
      const listed = (await directory.queuesOf(establishmentId)).filter((queue) => queue.archivedAt === null)
      const finished: Entry[] = []
      const active: Entry[] = []
      await Promise.all(
        listed.map(async (queue) => {
          const [ended, state] = await Promise.all([
            queues.finishedBetween(queue.queueId, window.from, window.to),
            queues.load(queue.queueId, [], { consistent: false }),
          ])
          finished.push(...ended)
          active.push(...state.entries.filter((entry) => isActive(entry.status)))
        }),
      )
      return ok(metricsView({ name: establishment.name }, range, window, computeMetrics(finished, active)))
    },

    // ----------------------------------------------------------------------------- colas

    'GET /api/v1/queues/{queueId}': async (request) => ok(await queueResponse(request, request.param('queueId'))),

    'PATCH /api/v1/queues/{queueId}': async (request) => {
      const queueId = request.param('queueId')
      const establishmentId = await authorizeQueue(request, queueId, 'OWNER')
      const settings = queueSettings(request.body(), { creating: false })
      const { state } = await queues.mutate(queueId, (session) => updateQueue(session, settings, staff(request.caller().sub)))
      return ok(queueView(state.queue, state.lanes, await establishmentName(establishmentId), request.baseUrl))
    },

    'DELETE /api/v1/queues/{queueId}': async (request) => {
      const queueId = request.param('queueId')
      await authorizeQueue(request, queueId, 'OWNER')
      await queues.mutate(queueId, (session) => archiveQueue(session, staff(request.caller().sub)))
      return noContent()
    },

    'PUT /api/v1/queues/{queueId}/status': async (request) => {
      const queueId = request.param('queueId')
      const establishmentId = await authorizeQueue(request, queueId)
      const status = request.body<{ status?: unknown }>().status
      if (typeof status !== 'string' || !QUEUE_STATUSES.includes(status as QueueStatus)) {
        throw badRequest('VALIDATION_FAILED', 'Invalid status', { status: 'must be OPEN, PAUSED or CLOSED' })
      }
      const { state } = await queues.mutate(queueId, (session) =>
        changeStatus(session, status as QueueStatus, staff(request.caller().sub)),
      )
      return ok(queueView(state.queue, state.lanes, await establishmentName(establishmentId), request.baseUrl))
    },

    'GET /api/v1/queues/{queueId}/board': async (request) => {
      const { state, establishmentId } = await visibleQueue(request, request.param('queueId'))
      return ok(boardView(state, await establishmentName(establishmentId), request.baseUrl, request.now))
    },

    'POST /api/v1/queues/{queueId}/calls': async (request) => {
      const queueId = request.param('queueId')
      await authorizeQueue(request, queueId)
      const body = request.body<{ entryId?: unknown; laneId?: unknown }>()
      const entryId = typeof body.entryId === 'string' ? body.entryId : undefined
      const laneId = typeof body.laneId === 'string' ? body.laneId : undefined
      const actor = staff(request.caller().sub)
      const { result: entry, state } = await queues.mutate(queueId, (session) =>
        entryId ? call(session, entryId, actor) : callNext(session, actor, laneId),
      )
      return ok(entryResponse(request, state, entry.id))
    },

    // El WebSocket del tablero: un ticket de un solo uso, así el token de Cognito no va en la URL.
    'POST /api/v1/queues/{queueId}/ws-tickets': async (request) => {
      const queueId = request.param('queueId')
      await authorizeQueue(request, queueId)
      return created(await directory.issueWsTicket({ userId: request.caller().sub, queueId }, request.now))
    },

    'GET /api/v1/queues/{queueId}/events': async (request) => {
      const queueId = request.param('queueId')
      await authorizeQueue(request, queueId)
      const requested = Number(request.query('limit') ?? EVENT_LIMIT.fallback)
      const limit = Number.isInteger(requested) ? Math.min(EVENT_LIMIT.max, Math.max(1, requested)) : EVENT_LIMIT.fallback
      return json(200, eventsOf(await queues.recentEvents(queueId, limit)))
    },

    'GET /api/v1/queues/{queueId}/metrics': async (request) => {
      const queueId = request.param('queueId')
      const establishmentId = await authorizeQueue(request, queueId)
      const range = parseRange(request.query('range'))
      const establishment = await requireEstablishment(establishmentId)
      const window = windowFor(establishment.timezone, RANGE_DAYS[range], request.now)
      const [finished, state] = await Promise.all([
        queues.finishedBetween(queueId, window.from, window.to),
        queues.load(queueId, [], { consistent: false }),
      ])
      const active = state.entries.filter((entry) => isActive(entry.status))
      return ok(metricsView({ queueId, name: state.queue.name }, range, window, computeMetrics(finished, active)))
    },

    // ----------------------------------------------------------------------------- carriles

    'GET /api/v1/queues/{queueId}/lanes': async (request) => {
      const { state } = await visibleQueue(request, request.param('queueId'))
      return json(200, liveLanes(state.lanes).map(laneView))
    },

    'POST /api/v1/queues/{queueId}/lanes': async (request) => {
      const queueId = request.param('queueId')
      await authorizeQueue(request, queueId, 'OWNER')
      const settings = laneSettings(request.body(), null)
      const { result: lane } = await queues.mutate(queueId, (session) =>
        createLane(session, newId(), settings, staff(request.caller().sub)),
      )
      return created(laneView(lane))
    },

    'PATCH /api/v1/queues/{queueId}/lanes/{laneId}': async (request) => {
      const queueId = request.param('queueId')
      const laneId = request.param('laneId')
      await authorizeQueue(request, queueId, 'OWNER')
      const body = request.body<Record<string, unknown>>()
      // PATCH parcial: lo que no viene conserva el valor actual del carril.
      const { result: lane } = await queues.mutate(queueId, (session) => {
        const current = session.state.lanes.find((candidate) => candidate.id === laneId && candidate.deletedAt === null)
        if (!current) throw notFound('LANE_NOT_FOUND', `Lane ${laneId} was not found`)
        const settings: LaneSettings = laneSettings(body, current)
        return updateLane(session, laneId, settings, staff(request.caller().sub))
      })
      return ok(laneView(lane))
    },

    'DELETE /api/v1/queues/{queueId}/lanes/{laneId}': async (request) => {
      const queueId = request.param('queueId')
      const laneId = request.param('laneId')
      await authorizeQueue(request, queueId, 'OWNER')
      await queues.mutate(queueId, (session) => retireLane(session, laneId, staff(request.caller().sub)))
      return noContent()
    },

    // ----------------------------------------------------------------------------- entradas

    'GET /api/v1/entries/{entryId}': async (request) => {
      const entryId = request.param('entryId')
      const { queueId } = await authorizeEntry(request, entryId)
      return ok(entryResponse(request, await queues.read(queueId, { entryIds: [entryId] }), entryId))
    },

    'PUT /api/v1/entries/{entryId}/status': async (request) => {
      const entryId = request.param('entryId')
      const { queueId } = await authorizeEntry(request, entryId)
      const status = request.body<{ status?: unknown }>().status
      if (typeof status !== 'string' || !ENTRY_STATUSES.includes(status as EntryStatus)) {
        throw badRequest('VALIDATION_FAILED', 'Invalid status', { status: `must be one of ${ENTRY_STATUSES.join(', ')}` })
      }
      const { state } = await queues.mutate(
        queueId,
        (session) => transition(session, entryId, status as EntryStatus, staff(request.caller().sub)),
        { entryIds: [entryId] },
      )
      return ok(entryResponse(request, state, entryId))
    },

    'GET /api/v1/entries/{entryId}/events': async (request) => {
      const entryId = request.param('entryId')
      const { queueId } = await authorizeEntry(request, entryId)
      const entry = await queues.loadEntryById(entryId)
      if (!entry) throw notFound('ENTRY_NOT_FOUND', `Entry ${entryId} was not found`)
      // Solo lo que pasó en la cola desde que esta persona se unió, no todo su historial.
      const found = (await queues.eventsSince(queueId, entry.joinedAt)).filter((item) => item['entryId'] === entryId)
      return json(200, eventsOf(found))
    },

    'GET /api/v1/entries/{entryId}/notifications': async (request) => {
      const entryId = request.param('entryId')
      await authorizeEntry(request, entryId)
      return json(200, (await directory.notificationsOf(entryId)).map(notificationView))
    },
  }
}

function defaultDependencies(): StaffDependencies {
  const table = createTableConfig()
  const userPoolId = process.env.USER_POOL_ID
  if (!userPoolId) throw new Error('USER_POOL_ID no está configurada')
  return { queues: new QueueStore(table), directory: new DirectoryStore(table), users: new CognitoUsers(userPoolId) }
}

let cached: ReturnType<typeof router> | undefined
export const handler: ReturnType<typeof router> = (event) => (cached ??= router(staffRoutes(defaultDependencies())))(event)
