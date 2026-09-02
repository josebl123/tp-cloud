/**
 * Mirrors the read models the Spring API returns.
 *
 * The backend serialises with non-null inclusion, so any field the server may omit is optional here.
 * That is not defensive typing for its own sake: `position` really is absent once a customer has been
 * served, and the UI has to render that case.
 */

export type QueueStatus = 'OPEN' | 'PAUSED' | 'CLOSED'
export type EntryStatus = 'WAITING' | 'CALLED' | 'SERVING' | 'SERVED' | 'LEFT' | 'NO_SHOW'
export type NoShowPolicy = 'KEEP_POSITION' | 'MOVE_BACK' | 'MOVE_TO_END' | 'REMOVE'
export type MembershipRole = 'OWNER' | 'STAFF'
export type MetricsRange = 'TODAY' | 'LAST_7_DAYS'
export type ActorType = 'CUSTOMER' | 'STAFF' | 'SYSTEM'
export type NotificationChannel = 'EMAIL' | 'SMS' | 'LOG'
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED'

export type NotificationType =
  | 'TICKET_CREATED'
  | 'APPROACHING_POSITION'
  | 'APPROACHING_TIME'
  | 'YOUR_TURN'
  | 'NO_SHOW'
  | 'QUEUE_CLOSED'

export type EventType =
  | 'QUEUE_CREATED'
  | 'QUEUE_UPDATED'
  | 'QUEUE_STATUS_CHANGED'
  | 'QUEUE_DELETED'
  | 'ENTRY_JOINED'
  | 'ENTRY_CALLED'
  | 'ENTRY_SERVING_STARTED'
  | 'ENTRY_SERVED'
  | 'ENTRY_LEFT'
  | 'ENTRY_NO_SHOW'
  | 'ENTRY_REQUEUED'
  | 'NOTIFICATION_SENT'

export interface UserView {
  id: string
  email: string
  displayName: string
  createdAt: string
}

export interface EstablishmentView {
  id: string
  name: string
  timezone: string
  role?: MembershipRole
  createdAt: string
}

export interface AuthResult {
  accessToken: string
  tokenType: string
  expiresInSeconds: number
  expiresAt: string
  user: UserView
  establishment?: EstablishmentView
}

export interface MemberView {
  membershipId: string
  userId: string
  email: string
  displayName: string
  role: MembershipRole
  joinedAt: string
}

export interface QueueView {
  id: string
  establishmentId: string
  establishmentName: string
  name: string
  description?: string
  status: QueueStatus
  serviceStations: number
  defaultServiceMinutes: number
  maxSize?: number
  gracePeriodSeconds: number
  noShowPolicy: NoShowPolicy
  moveBackPositions: number
  notifyAtPosition?: number
  notifyAtMinutes?: number
  requirePartySize: boolean
  joinUrl: string
  createdAt: string
  updatedAt: string
}

export interface QueueSummary {
  id: string
  name: string
  establishmentName: string
  status: QueueStatus
}

export interface EntryView {
  id: string
  ticketToken: string
  ticketNumber: number
  customerName: string
  customerEmail?: string
  customerPhone?: string
  partySize?: number
  status: EntryStatus
  position?: number
  peopleAhead?: number
  estimatedWaitMinutes?: number
  noShowCount: number
  joinedAt: string
  calledAt?: string
  servingStartedAt?: string
  finishedAt?: string
  graceExpiresAt?: string
  graceSecondsRemaining?: number
}

export interface TicketView {
  ticketToken: string
  ticketNumber: number
  customerName: string
  partySize?: number
  status: EntryStatus
  position?: number
  peopleAhead?: number
  estimatedWaitMinutes?: number
  noShowCount: number
  joinedAt: string
  calledAt?: string
  finishedAt?: string
  graceExpiresAt?: string
  graceSecondsRemaining?: number
  queue: QueueSummary
  ticketUrl: string
}

export interface QueueSnapshot {
  queue: QueueView
  waiting: EntryView[]
  inService: EntryView[]
  waitingCount: number
  inServiceCount: number
  estimatedWaitMinutesForNewEntry?: number
  averageServiceMinutes: number
  usingDefaultServiceTime: boolean
  generatedAt: string
}

export interface PublicQueueView {
  id: string
  name: string
  description?: string
  establishmentName: string
  status: QueueStatus
  acceptingEntries: boolean
  full: boolean
  waitingCount: number
  estimatedWaitMinutes?: number
  requirePartySize: boolean
  maxSize?: number
}

export interface MetricsView {
  queueId?: string
  scopeName: string
  range: MetricsRange
  from: string
  to: string
  waitingNow: number
  inServiceNow: number
  servedCount: number
  noShowCount: number
  leftCount: number
  finishedCount: number
  averageWaitMinutes?: number
  averageServiceMinutes?: number
  abandonmentRate: number
  noShowRate: number
}

export interface QueueEventView {
  id: string
  queueId: string
  entryId?: string
  type: EventType
  actorType: ActorType
  actorId?: string
  detail?: string
  occurredAt: string
}

export interface NotificationView {
  id: string
  type: NotificationType
  channel: NotificationChannel
  status: NotificationStatus
  destination: string
  subject: string
  createdAt: string
  sentAt?: string
}

export interface JoinPayload {
  name: string
  email?: string
  phone?: string
  partySize?: number
  /** BCP 47 tag. Stored server-side so later notifications keep the customer's language. */
  locale?: string
}
