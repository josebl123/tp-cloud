// El modelo del dominio de Q, sin nada de AWS: estos tipos son lo que las reglas de negocio leen y
// modifican. La persistencia los traduce a ítems de DynamoDB (src/persistence/items.ts).

export const ENTRY_STATUSES = ['WAITING', 'CALLED', 'SERVING', 'SERVED', 'LEFT', 'NO_SHOW'] as const
export type EntryStatus = (typeof ENTRY_STATUSES)[number]

/** Estados que todavía ocupan un lugar en la fila. */
export const ACTIVE_STATUSES: readonly EntryStatus[] = ['WAITING', 'CALLED', 'SERVING']
/** Llamados o siendo atendidos: ocupan un puesto de atención antes que cualquiera que espera. */
export const IN_SERVICE_STATUSES: readonly EntryStatus[] = ['CALLED', 'SERVING']

export const isActive = (status: EntryStatus): boolean => ACTIVE_STATUSES.includes(status)
export const isTerminal = (status: EntryStatus): boolean => !isActive(status)

export type QueueStatus = 'OPEN' | 'PAUSED' | 'CLOSED'
export type NoShowPolicy = 'KEEP_POSITION' | 'MOVE_BACK' | 'MOVE_TO_END' | 'REMOVE'
export type CallStrategy = 'GLOBAL_AGE' | 'LANE_PRIORITY' | 'ROUND_ROBIN'
export type LaneCapacityMode = 'GROUPS' | 'PERSONS'
export type MembershipRole = 'OWNER' | 'STAFF'
export type ActorType = 'CUSTOMER' | 'STAFF' | 'SYSTEM'
export type SupportedLocale = 'en' | 'es'

export type EventType =
  | 'QUEUE_CREATED'
  | 'QUEUE_UPDATED'
  | 'QUEUE_STATUS_CHANGED'
  | 'QUEUE_ARCHIVED'
  | 'QUEUE_CLOSED'
  | 'LANE_CHANGED'
  | 'ENTRY_JOINED'
  | 'ENTRY_CALLED'
  | 'ENTRY_SERVING_STARTED'
  | 'ENTRY_SERVED'
  | 'ENTRY_LEFT'
  | 'ENTRY_NO_SHOW'
  | 'ENTRY_REQUEUED'

export type NotificationType =
  | 'TICKET_CREATED'
  | 'APPROACHING_POSITION'
  | 'APPROACHING_TIME'
  | 'YOUR_TURN'
  | 'NO_SHOW'
  | 'QUEUE_CLOSED'

export interface Establishment {
  id: string
  name: string
  timezone: string
  createdAt: string
}

export interface Membership {
  /** `sub` del usuario en Cognito. */
  userId: string
  establishmentId: string
  role: MembershipRole
  createdAt: string
  /**
   * Copia del email y del nombre que tenía en Cognito al sumarse. El listado de miembros se lee de
   * acá, sin una llamada a Cognito por cada uno.
   */
  email?: string
  displayName?: string
}

/** Configuración y contadores de una cola: el ítem `META` de su partición. */
export interface Queue {
  id: string
  establishmentId: string
  name: string
  description: string | null
  status: QueueStatus
  archivedAt: string | null
  serviceStations: number
  defaultServiceMinutes: number
  maxSize: number | null
  gracePeriodSeconds: number
  noShowPolicy: NoShowPolicy
  moveBackPositions: number
  notifyAtPosition: number | null
  notifyAtMinutes: number | null
  requirePartySize: boolean
  callStrategy: CallStrategy
  roundRobinPosition: number
  nextTicketNumber: number
  /** Secuencia que produce las claves de orden de quien entra al final. */
  nextOrderSequence: number
  /** Duraciones en segundos de los últimos servicios terminados, la más nueva al final. */
  recentServiceSeconds: number[]
  /** Control optimista: toda escritura sobre la cola exige la versión que leyó. */
  version: number
  createdAt: string
  updatedAt: string
}

export interface Lane {
  id: string
  queueId: string
  name: string
  minPartySize: number
  maxPartySize: number | null
  priority: number
  capacityMode: LaneCapacityMode
  maxSize: number | null
  timeFactor: number
  active: boolean
  createdAt: string
  deletedAt: string | null
}

export interface Entry {
  id: string
  queueId: string
  laneId: string
  ticketToken: string
  ticketNumber: number
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  partySize: number
  locale: SupportedLocale
  status: EntryStatus
  /** Clave de orden fraccionaria (ver ordering.ts). Solo significa algo mientras espera. */
  orderKey: string
  /** Aumenta cada vez que vuelve a esperar: habilita de nuevo los avisos de esa pasada. */
  notificationCycle: number
  noShowCount: number
  joinedAt: string
  calledAt: string | null
  servingStartedAt: string | null
  finishedAt: string | null
  graceExpiresAt: string | null
}

/** Un hecho de dominio. Se escribe en la misma transacción que el cambio que lo produjo. */
export interface DomainEvent {
  id: string
  queueId: string
  entryId: string | null
  type: EventType
  actorType: ActorType
  actorId: string | null
  /** Ciclo de avisos de la entrada al momento del evento, para deduplicar aguas abajo. */
  cycle: number | null
  detail: Record<string, string | number | boolean | null>
  occurredAt: string
}

/** Un aviso a un cliente. Hay como mucho uno por (entrada, tipo, ciclo). */
export interface NotificationRecord {
  entryId: string
  type: NotificationType
  cycle: number
  status: 'PENDING' | 'SENT' | 'FAILED'
  channel: 'EMAIL' | 'LOG'
  destination: string
  attempts: number
  createdAt: string
  sentAt: string | null
  failureReason: string | null
  /** El asunto en el idioma del cliente: lo muestra el historial de avisos. */
  subject?: string
}
