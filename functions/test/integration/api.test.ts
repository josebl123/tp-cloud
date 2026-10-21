import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { beforeAll, describe, expect, it } from 'vitest'
import type { UserDirectory } from '../../src/api/users.js'
import type { UserView } from '../../src/api/views.js'
import { publicRoutes } from '../../src/handlers/public.js'
import { seed } from '../../src/handlers/seed.js'
import { staffRoutes } from '../../src/handlers/staff.js'
import { router } from '../../src/http/api.js'
import type { Fixture } from './support.js'
import { fixture } from './support.js'

// Los handlers de punta a punta contra DynamoDB Local, con eventos de API Gateway armados a mano. Lo
// único falso es Cognito: el token ya llega validado (como lo deja el authorizer) y el directorio de
// usuarios vive en memoria.

const OWNER = { sub: 'owner-sub', email: 'duena@example.com', name: 'Dueña' }
const STAFF = { sub: 'staff-sub', email: 'mozo@example.com', name: 'Mozo' }
const STRANGER = { sub: 'otro-sub', email: 'otro@example.com', name: 'Otro' }

class MemoryUsers implements UserDirectory {
  readonly byId = new Map<string, UserView>()

  async get(sub: string) {
    return this.byId.get(sub) ?? null
  }
  async findByEmail(email: string) {
    return [...this.byId.values()].find((user) => user.email === email) ?? null
  }
  async create(input: { email: string; password: string; displayName: string }) {
    const user = { id: `sub-${input.email}`, email: input.email, displayName: input.displayName, createdAt: 'x' }
    this.byId.set(user.id, user)
    return user
  }
}

interface Call {
  method: string
  resource: string
  params?: Record<string, string>
  query?: Record<string, string>
  body?: unknown
  // Así llegan los JSON con binary_media_types en "*/*".
  base64?: boolean
  caller?: { sub: string; email: string; name: string }
  ip?: string
}

function event(call: Call): APIGatewayProxyEvent {
  const path = Object.entries(call.params ?? {}).reduce((acc, [key, value]) => acc.replace(`{${key}}`, value), call.resource)
  const text = call.body === undefined ? null : JSON.stringify(call.body)
  return {
    httpMethod: call.method,
    resource: call.resource,
    path,
    pathParameters: call.params ?? null,
    queryStringParameters: call.query ?? null,
    body: text && call.base64 ? Buffer.from(text).toString('base64') : text,
    isBase64Encoded: Boolean(text && call.base64),
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      domainName: 'abc123.execute-api.us-east-1.amazonaws.com',
      stage: 'prod',
      identity: { sourceIp: call.ip ?? '203.0.113.1' },
      authorizer: call.caller ? { claims: call.caller } : null,
    },
  } as unknown as APIGatewayProxyEvent
}

let f: Fixture
let publicApi: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>
let staffApi: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>
const users = new MemoryUsers()

const send = async (api: typeof publicApi, call: Call) => {
  const response = await api(event(call))
  const isJson = response.headers?.['Content-Type']?.toString().includes('json')
  return { ...response, json: isJson && response.body ? JSON.parse(response.body) : undefined }
}
const asStaff = (call: Call, caller = OWNER) => send(staffApi, { ...call, caller })
const asPublic = (call: Call) => send(publicApi, call)

beforeAll(async () => {
  f = await fixture()
  publicApi = router(publicRoutes({ table: f.table, queues: f.queues, directory: f.directory, joinsPerMinute: 1000 }))
  staffApi = router(staffRoutes({ queues: f.queues, directory: f.directory, users }))
  users.byId.set(OWNER.sub, { id: OWNER.sub, email: OWNER.email, displayName: OWNER.name, createdAt: '2026-01-01T00:00:00.000Z' })
})

async function establishmentWithQueue(settings: Record<string, unknown> = {}) {
  const establishment = await asStaff({ method: 'POST', resource: '/api/v1/establishments', body: { name: 'La Parrilla' } })
  expect(establishment.statusCode).toBe(201)
  const establishmentId = establishment.json.id as string
  const queue = await asStaff({
    method: 'POST',
    resource: '/api/v1/establishments/{establishmentId}/queues',
    params: { establishmentId },
    body: { name: 'Cena', ...settings },
  })
  expect(queue.statusCode).toBe(201)
  return { establishmentId, queueId: queue.json.id as string }
}

const join = (queueId: string, body: Record<string, unknown> = {}, ip?: string) =>
  asPublic({
    method: 'POST',
    resource: '/api/v1/public/queues/{queueId}/entries',
    params: { queueId },
    body: { name: 'Ana', email: 'ana@example.com', partySize: 2, locale: 'es', ...body },
    base64: true,
    ...(ip ? { ip } : {}),
  })

describe('API de punta a punta', () => {
  it('el staff crea su local y una cola; el cliente se une, el staff lo llama y el ticket lo refleja', async () => {
    const { establishmentId, queueId } = await establishmentWithQueue()

    const list = await asStaff({ method: 'GET', resource: '/api/v1/establishments' })
    expect(list.json).toContainEqual(expect.objectContaining({ id: establishmentId, role: 'OWNER' }))

    const landing = await asPublic({ method: 'GET', resource: '/api/v1/public/queues/{queueId}', params: { queueId } })
    expect(landing.json).toMatchObject({ name: 'Cena', establishmentName: 'La Parrilla', acceptingEntries: true, waitingCount: 0 })

    const joined = await join(queueId)
    expect(joined.statusCode).toBe(201)
    expect(joined.json.ticketUrl).toBe(`https://abc123.execute-api.us-east-1.amazonaws.com/prod/t/?token=${joined.json.ticketToken}`)
    expect(joined.headers?.['Location']).toContain(`/api/v1/public/tickets/${joined.json.ticketToken}`)
    // Como en la API Java: los campos null no viajan.
    expect(joined.json).not.toHaveProperty('calledAt')

    const board = await asStaff({ method: 'GET', resource: '/api/v1/queues/{queueId}/board', params: { queueId } })
    expect(board.json).toMatchObject({ waitingCount: 1, inServiceCount: 0 })
    expect(board.json.queue.joinUrl).toBe(`https://abc123.execute-api.us-east-1.amazonaws.com/prod/q/?id=${queueId}`)
    expect(board.json.lanes[0].waitingPersons).toBe(2)

    const called = await asStaff({ method: 'POST', resource: '/api/v1/queues/{queueId}/calls', params: { queueId }, body: {} })
    expect(called.json).toMatchObject({ status: 'CALLED', customerName: 'Ana' })

    const ticket = await asPublic({
      method: 'GET',
      resource: '/api/v1/public/tickets/{ticketToken}',
      params: { ticketToken: joined.json.ticketToken },
    })
    expect(ticket.json).toMatchObject({ status: 'CALLED', queue: { name: 'Cena', establishmentName: 'La Parrilla' } })
    expect(ticket.json.graceSecondsRemaining).toBeGreaterThan(0)

    const served = await asStaff({
      method: 'PUT',
      resource: '/api/v1/entries/{entryId}/status',
      params: { entryId: called.json.id },
      body: { status: 'SERVED' },
    })
    expect(served.json.status).toBe('SERVED')

    const history = await asStaff({ method: 'GET', resource: '/api/v1/entries/{entryId}/events', params: { entryId: called.json.id } })
    expect(history.json.map((item: { type: string }) => item.type)).toEqual(['ENTRY_SERVED', 'ENTRY_CALLED', 'ENTRY_JOINED'])
    expect(history.json[2].detail).toMatch(/ticketNumber=1/)

    const metrics = await asStaff({ method: 'GET', resource: '/api/v1/queues/{queueId}/metrics', params: { queueId }, query: { range: 'TODAY' } })
    expect(metrics.json).toMatchObject({ scopeName: 'Cena', servedCount: 1, range: 'TODAY' })
  })

  it('el cliente puede irse, y su ticket queda como LEFT', async () => {
    const { queueId } = await establishmentWithQueue()
    const joined = await join(queueId)
    const left = await asPublic({
      method: 'DELETE',
      resource: '/api/v1/public/tickets/{ticketToken}',
      params: { ticketToken: joined.json.ticketToken },
    })
    expect(left.json.status).toBe('LEFT')
  })

  it('autoriza contra el establecimiento de la cola leída', async () => {
    const { establishmentId, queueId } = await establishmentWithQueue()

    const stranger = await asStaff({ method: 'GET', resource: '/api/v1/queues/{queueId}/board', params: { queueId } }, STRANGER)
    expect(stranger.statusCode).toBe(403)
    expect(stranger.json.code).toBe('NOT_A_MEMBER')
    expect(stranger.headers?.['Content-Type']).toBe('application/problem+json')

    users.byId.set(STAFF.sub, { id: STAFF.sub, email: STAFF.email, displayName: STAFF.name, createdAt: 'x' })
    // Con contraseña, el dueño cree que crea la cuenta: si ya existe, no se la agrega en silencio.
    const hijack = await asStaff({
      method: 'POST',
      resource: '/api/v1/establishments/{establishmentId}/members',
      params: { establishmentId },
      body: { email: STAFF.email, password: 'contraseña-nueva', role: 'OWNER' },
    })
    expect(hijack.statusCode).toBe(409)
    expect(hijack.json.code).toBe('EMAIL_TAKEN')
    expect(await f.directory.membership(STAFF.sub, establishmentId)).toBeNull()

    const added = await asStaff({
      method: 'POST',
      resource: '/api/v1/establishments/{establishmentId}/members',
      params: { establishmentId },
      body: { email: STAFF.email, role: 'STAFF' },
    })
    expect(added.statusCode).toBe(201)

    const board = await asStaff({ method: 'GET', resource: '/api/v1/queues/{queueId}/board', params: { queueId } }, STAFF)
    expect(board.statusCode).toBe(200)
    const configure = await asStaff({ method: 'PATCH', resource: '/api/v1/queues/{queueId}', params: { queueId }, body: { name: 'Otra' } }, STAFF)
    expect(configure.json.code).toBe('OWNER_ONLY')

    // El ticket del WebSocket del tablero: solo para miembros, de un solo uso y con vencimiento.
    const wsTicket = await asStaff({ method: 'POST', resource: '/api/v1/queues/{queueId}/ws-tickets', params: { queueId }, body: {} }, STAFF)
    expect(wsTicket.statusCode).toBe(201)
    expect(wsTicket.json).toEqual({ ticket: expect.any(String), expiresAt: expect.any(String) })
    const strangerTicket = await asStaff({ method: 'POST', resource: '/api/v1/queues/{queueId}/ws-tickets', params: { queueId }, body: {} }, STRANGER)
    expect(strangerTicket.statusCode).toBe(403)

    const members = await asStaff({ method: 'GET', resource: '/api/v1/establishments/{establishmentId}/members', params: { establishmentId } })
    expect(members.json.map((member: { email: string }) => member.email).sort()).toEqual([OWNER.email, STAFF.email].sort())
  })

  it('valida tipos y vacía los valores opcionales con las banderas clear*', async () => {
    const { queueId } = await establishmentWithQueue({ maxSize: 5 })

    const wrong = await asStaff({ method: 'PATCH', resource: '/api/v1/queues/{queueId}', params: { queueId }, body: { maxSize: 'mucho', noShowPolicy: 'NADA' } })
    expect(wrong.statusCode).toBe(400)
    expect(Object.keys(wrong.json.errors).sort()).toEqual(['maxSize', 'noShowPolicy'])

    const cleared = await asStaff({ method: 'PATCH', resource: '/api/v1/queues/{queueId}', params: { queueId }, body: { clearMaxSize: true, serviceStations: 2 } })
    expect(cleared.json).toMatchObject({ serviceStations: 2 })
    expect(cleared.json).not.toHaveProperty('maxSize')

    const malformed = await staffApi({ ...event({ method: 'PATCH', resource: '/api/v1/queues/{queueId}', params: { queueId }, caller: OWNER }), body: '{nope' })
    expect(JSON.parse(malformed.body).code).toBe('MALFORMED_JSON')
  })

  it('los carriles: alta, PATCH parcial y disponibilidad por tamaño de grupo', async () => {
    const { queueId } = await establishmentWithQueue()
    const lanes = await asStaff({ method: 'GET', resource: '/api/v1/queues/{queueId}/lanes', params: { queueId } })
    const defaultLane = lanes.json[0]

    await asStaff({ method: 'PATCH', resource: '/api/v1/queues/{queueId}/lanes/{laneId}', params: { queueId, laneId: defaultLane.id }, body: { maxPartySize: 2 } })
    const big = await asStaff({
      method: 'POST',
      resource: '/api/v1/queues/{queueId}/lanes',
      params: { queueId },
      body: { name: 'Grupos', minPartySize: 3, maxPartySize: 6, priority: 1 },
    })
    expect(big.statusCode).toBe(201)

    const forFour = await asPublic({ method: 'GET', resource: '/api/v1/public/queues/{queueId}/availability', params: { queueId }, query: { partySize: '4' } })
    expect(forFour.json).toMatchObject({ eligible: true, available: true, lane: { name: 'Grupos' }, lanePosition: 1 })
    const forTen = await asPublic({ method: 'GET', resource: '/api/v1/public/queues/{queueId}/availability', params: { queueId }, query: { partySize: '10' } })
    expect(forTen.json).toMatchObject({ eligible: false, available: false })
  })

  it('limita las uniones por IP y devuelve el QR como PNG', async () => {
    const { queueId } = await establishmentWithQueue()
    const limited = router(publicRoutes({ table: f.table, queues: f.queues, directory: f.directory, joinsPerMinute: 1 }))
    const attempt = () => send(limited, { method: 'POST', resource: '/api/v1/public/queues/{queueId}/entries', params: { queueId }, body: { name: 'Bo', email: 'bo@example.com' }, ip: '198.51.100.9' })
    expect((await attempt()).statusCode).toBe(201)
    const second = await attempt()
    expect(second.statusCode).toBe(429)
    expect(second.json.code).toBe('TOO_MANY_REQUESTS')

    const qr = await publicApi(event({ method: 'GET', resource: '/api/v1/public/queues/{queueId}/qr', params: { queueId }, query: { size: '256' } }))
    expect(qr.isBase64Encoded).toBe(true)
    expect(Buffer.from(qr.body, 'base64').subarray(1, 4).toString()).toBe('PNG')
  })

  it('responde 404 con el código estable para un ticket que no existe', async () => {
    const missing = await asPublic({ method: 'GET', resource: '/api/v1/public/tickets/{ticketToken}', params: { ticketToken: 'nope' } })
    expect(missing.statusCode).toBe(404)
    expect(missing.json).toMatchObject({ code: 'TICKET_NOT_FOUND', status: 404, title: 'Not Found' })
  })

  it('la salud escribe y lee la tabla', async () => {
    const health = await asPublic({ method: 'GET', resource: '/api/v1/health' })
    expect(health.json).toMatchObject({ status: 'ok' })
  })

  it('sin claims del authorizer, el staff recibe 401', async () => {
    const response = await staffApi(event({ method: 'GET', resource: '/api/v1/establishments' }))
    expect(response.statusCode).toBe(401)
  })
})

describe('datos de demo', () => {
  it('cargan un local con dos colas y carriles, y volver a cargarlos no duplica nada', async () => {
    const input = {
      establishment: { id: 'demo-est', name: 'Demo', timezone: 'America/Argentina/Buenos_Aires' },
      owner: { sub: 'demo-owner', email: 'demo@example.com', displayName: 'Demo' },
      queues: [
        {
          id: 'demo-mesas',
          defaultLaneId: 'demo-lane-chicos',
          settings: { name: 'Mesas', callStrategy: 'ROUND_ROBIN' as const },
          lanes: [
            { id: 'demo-lane-chicos', name: '1-2', minPartySize: 1, maxPartySize: 2, priority: 0 },
            { id: 'demo-lane-grandes', name: '3+', minPartySize: 3, maxPartySize: null, priority: 1 },
          ],
        },
        { id: 'demo-barra', defaultLaneId: 'demo-lane-barra', settings: { name: 'Barra' } },
      ],
    }
    expect(await seed(input, f.table)).toEqual({ establishment: 'created', queues: { 'demo-mesas': 'created', 'demo-barra': 'created' } })
    expect(await seed(input, f.table)).toEqual({ establishment: 'existing', queues: { 'demo-mesas': 'existing', 'demo-barra': 'existing' } })

    const mesas = await f.queues.load('demo-mesas')
    expect(mesas.lanes.map((lane) => lane.name).sort()).toEqual(['1-2', '3+'])
    expect(await f.directory.membership('demo-owner', 'demo-est')).toMatchObject({ role: 'OWNER', email: 'demo@example.com' })
  })
})
