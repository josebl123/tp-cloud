import { getToken } from './session'
import type {
  AuthResult,
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
  QueueEventView,
  QueueSnapshot,
  QueueStatus,
  QueueView,
  TicketView,
} from './types'

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '')
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
  auth: {
    register: (body: {
      email: string
      password: string
      displayName: string
      establishmentName: string
      timezone?: string
    }) => request<AuthResult>('/auth/register', { method: 'POST', body, auth: false }),

    login: (body: { email: string; password: string }) =>
      request<AuthResult>('/auth/login', { method: 'POST', body, auth: false }),

    me: () => request<AuthResult['user']>('/auth/me'),
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
    call: (id: string, entryId?: string) =>
      request<EntryView>(`/queues/${id}/calls`, { method: 'POST', body: { entryId: entryId ?? null } }),
    events: (id: string, limit = 40) => request<QueueEventView[]>(`/queues/${id}/events?limit=${limit}`),
    metrics: (id: string, range: MetricsRange) =>
      request<MetricsView>(`/queues/${id}/metrics?range=${range}`),
  },

  entries: {
    setStatus: (entryId: string, status: EntryStatus) =>
      request<EntryView>(`/entries/${entryId}/status`, { method: 'PUT', body: { status } }),
    notifications: (entryId: string) => request<NotificationView[]>(`/entries/${entryId}/notifications`),
  },

  publicApi: {
    queue: (queueId: string, signal?: AbortSignal) =>
      request<PublicQueueView>(`/public/queues/${queueId}`, { auth: false, signal }),
    join: (queueId: string, body: JoinPayload) =>
      request<TicketView>(`/public/queues/${queueId}/entries`, { method: 'POST', body, auth: false }),
    ticket: (token: string, signal?: AbortSignal) =>
      request<TicketView>(`/public/tickets/${token}`, { auth: false, signal }),
    leave: (token: string) =>
      request<TicketView>(`/public/tickets/${token}`, { method: 'DELETE', auth: false }),
    notifications: (token: string) =>
      request<NotificationView[]>(`/public/tickets/${token}/notifications`, { auth: false }),
    qrUrl: (queueId: string, size = 512) => `${V1}/public/queues/${queueId}/qr?size=${size}`,
  },

  streams: {
    /** EventSource cannot send headers, so the staff stream takes the token in the query string. */
    queue: (queueId: string, token: string) =>
      `${V1}/queues/${queueId}/stream?access_token=${encodeURIComponent(token)}`,
    ticket: (ticketToken: string) => `${V1}/public/tickets/${ticketToken}/stream`,
  },
}
