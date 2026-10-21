import { loadRuntimeConfig } from './config'
import { getToken, setToken } from './session'
import type {
  UserView,
  EntryStatus,
  EntryView,
  EstablishmentView,
  JoinPayload,
  MemberView,
  MembershipRole,
  MetricsRange,
  MetricsView,
  NotificationView,
  PublicQueueView,
  QueueAvailabilityView,
  QueueEventView,
  QueueSnapshot,
  QueueStatus,
  QueueView,
  QueueLaneView,
  TicketView,
} from './types'

/**
 * The API is served from the same origin as the site, so every call is relative: `/prod` in the
 * deployed build (the stage name API Gateway puts in front of every path), empty in development,
 * where `next dev` proxies `/api/v1` to the deployed API (see `next.config.ts`).
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
const V1 = `${API_BASE}/api/v1`

/** An RFC 7807 problem response, surfaced with the backend's stable `code` intact. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fieldErrors: Record<string, string>

  constructor(status: number, code: string, message: string, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }

  /** The first field-level message, which is usually the one worth showing on a form. */
  get firstFieldError(): string | undefined {
    return Object.values(this.fieldErrors)[0]
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  auth?: boolean
  signal?: AbortSignal
}

/**
 * How many times a request that lost a race is sent again. Every change to a queue is checked
 * against the version it read; when two people change the same queue at once, one of them gets 409
 * CONCURRENT_MODIFICATION after the server already retried several times. Nothing was written, so
 * sending it again is safe, and it almost always goes through.
 */
const CONFLICT_RETRIES = 2

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send<T>(path, options)
    } catch (cause) {
      const lostRace = cause instanceof ApiError && cause.status === 409 && cause.code === 'CONCURRENT_MODIFICATION'
      if (!lostRace || attempt >= CONFLICT_RETRIES || options.signal?.aborted) throw cause
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1) + Math.random() * 150))
    }
  }
}

async function send<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options
  const headers: Record<string, string> = { Accept: 'application/json' }

  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(`${V1}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection and try again.")
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  const payload: unknown = text ? safeParse(text) : undefined

  if (!response.ok) {
    /*
     * A staff token lasts twelve hours, so it expires mid-shift rather than between sessions. The
     * 401 that follows used to be handled nowhere: the board kept rendering its last snapshot of
     * customer names and emails, every action failed with a message nobody could act on, and there
     * was no route back to the sign-in screen. Dropping the token here notifies every subscriber,
     * which clears the user and lets the panel guard do its job. Public endpoints are exempt - a
     * customer has no session to end.
     */
    if (response.status === 401 && !path.startsWith('/public/') && getToken()) {
      setToken(null)
    }
    throw toApiError(response.status, payload)
  }
  return payload as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function toApiError(status: number, payload: unknown): ApiError {
  const problem = (payload ?? {}) as {
    code?: string
    detail?: string
    title?: string
    errors?: Record<string, string>
  }
  const fieldErrors = problem.errors ?? {}
  const message =
    Object.values(fieldErrors)[0] ?? problem.detail ?? problem.title ?? 'Something went wrong.'
  return new ApiError(status, problem.code ?? 'UNKNOWN', message, fieldErrors)
}

export const api = {
  // Signing in and signing up talk to Cognito directly (cognito.ts); the API only knows who you are.
  auth: {
    me: () => request<UserView>('/auth/me'),
  },

  establishments: {
    list: () => request<EstablishmentView[]>('/establishments'),
    create: (body: { name: string; timezone?: string }) =>
      request<EstablishmentView>('/establishments', { method: 'POST', body }),
    members: (id: string) => request<MemberView[]>(`/establishments/${id}/members`),
    addMember: (
      id: string,
      body: { email: string; password?: string; displayName?: string; role: MembershipRole },
    ) => request<MemberView>(`/establishments/${id}/members`, { method: 'POST', body }),
    queues: (id: string) => request<QueueView[]>(`/establishments/${id}/queues`),
    createQueue: (id: string, body: Record<string, unknown>) =>
      request<QueueView>(`/establishments/${id}/queues`, { method: 'POST', body }),
    metrics: (id: string, range: MetricsRange) =>
      request<MetricsView>(`/establishments/${id}/metrics?range=${range}`),
  },

  queues: {
    get: (id: string) => request<QueueView>(`/queues/${id}`),
    update: (id: string, body: Record<string, unknown>) =>
      request<QueueView>(`/queues/${id}`, { method: 'PATCH', body }),
    remove: (id: string) => request<void>(`/queues/${id}`, { method: 'DELETE' }),
    setStatus: (id: string, status: QueueStatus) =>
      request<QueueView>(`/queues/${id}/status`, { method: 'PUT', body: { status } }),
    board: (id: string, signal?: AbortSignal) =>
      request<QueueSnapshot>(`/queues/${id}/board`, { signal }),
    call: (id: string, entryId?: string, laneId?: string) =>
      request<EntryView>(`/queues/${id}/calls`, { method: 'POST', body: { entryId: entryId ?? null, laneId: laneId ?? null } }),
    events: (id: string, limit = 40) => request<QueueEventView[]>(`/queues/${id}/events?limit=${limit}`),
    metrics: (id: string, range: MetricsRange) =>
      request<MetricsView>(`/queues/${id}/metrics?range=${range}`),
    lanes: (id: string) => request<QueueLaneView[]>(`/queues/${id}/lanes`),
    createLane: (id: string, body: Record<string, unknown>) =>
      request<QueueLaneView>(`/queues/${id}/lanes`, { method: 'POST', body }),
    updateLane: (queueId: string, laneId: string, body: Record<string, unknown>) =>
      request<QueueLaneView>(`/queues/${queueId}/lanes/${laneId}`, { method: 'PATCH', body }),
    removeLane: (queueId: string, laneId: string) =>
      request<void>(`/queues/${queueId}/lanes/${laneId}`, { method: 'DELETE' }),
  },

  entries: {
    setStatus: (entryId: string, status: EntryStatus) =>
      request<EntryView>(`/entries/${entryId}/status`, { method: 'PUT', body: { status } }),
    notifications: (entryId: string) => request<NotificationView[]>(`/entries/${entryId}/notifications`),
  },

  publicApi: {
    // These two come straight out of the address bar, so they are encoded rather than pasted into
    // the path: a token containing `../` or a `?` would otherwise retarget the request at a
    // different endpoint entirely, and the page would fail in a way that looks like a server fault.
    queue: (queueId: string, signal?: AbortSignal) =>
      request<PublicQueueView>(`/public/queues/${encodeURIComponent(queueId)}`, { auth: false, signal }),
    availability: (queueId: string, partySize: number, signal?: AbortSignal) =>
      request<QueueAvailabilityView>(`/public/queues/${encodeURIComponent(queueId)}/availability?partySize=${partySize}`, { auth: false, signal }),
    join: (queueId: string, body: JoinPayload) =>
      request<TicketView>(`/public/queues/${encodeURIComponent(queueId)}/entries`, { method: 'POST', body, auth: false }),
    ticket: (token: string, signal?: AbortSignal) =>
      request<TicketView>(`/public/tickets/${encodeURIComponent(token)}`, { auth: false, signal }),
    leave: (token: string) =>
      request<TicketView>(`/public/tickets/${encodeURIComponent(token)}`, { method: 'DELETE', auth: false }),
    notifications: (token: string) =>
      request<NotificationView[]>(`/public/tickets/${encodeURIComponent(token)}/notifications`, { auth: false }),
    qrUrl: (queueId: string, size = 512) => `${V1}/public/queues/${queueId}/qr?size=${size}`,
  },

  /**
   * The realtime WebSocket, when the deployment has one. Each resolves to the address to open, or
   * `null` when there is no WebSocket to open, in which case the live views keep polling.
   *
   * The browser cannot send headers when opening a WebSocket, so the credential travels in the URL:
   * a customer's ticket token (already public in their own page's address), or for staff a one-time
   * ticket that expires in a minute - never the Cognito token itself.
   */
  realtime: {
    queue: async (queueId: string): Promise<string | null> => {
      const base = await websocketBase()
      if (!base) return null
      const { ticket } = await request<{ ticket: string }>(`/queues/${queueId}/ws-tickets`, { method: 'POST', body: {} })
      return `${base}?wsTicket=${encodeURIComponent(ticket)}`
    },
    ticket: async (ticketToken: string): Promise<string | null> => {
      const base = await websocketBase()
      return base ? `${base}?ticket=${encodeURIComponent(ticketToken)}` : null
    },
  },
}

async function websocketBase(): Promise<string | null> {
  try {
    return (await loadRuntimeConfig()).websocketUrl ?? null
  } catch {
    return null
  }
}
