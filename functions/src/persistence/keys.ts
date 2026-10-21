// Las claves de la tabla única `q-main`. Todo lo que arma un PK o un SK pasa por acá, así el modelo
// de datos se lee en un solo archivo.

import type { Entry, EntryStatus } from '../domain/types.js'

export const queuePk = (queueId: string) => `QUEUE#${queueId}`
export const QUEUE_META_SK = 'META'
export const laneSk = (laneId: string) => `LANE#${laneId}`

/**
 * El SK de una entrada codifica su estado, así una consulta por prefijo devuelve cada grupo ya
 * ordenado: `W#` es la fila en orden, `A#` los llamados y atendiéndose, `F#` las terminadas por hora
 * de fin (lo que leen las métricas por rango de fecha).
 */
export function entrySk(entry: Pick<Entry, 'id' | 'status' | 'orderKey' | 'finishedAt'>): string {
  const status: EntryStatus = entry.status
  if (status === 'WAITING') return `W#${entry.orderKey}`
  if (status === 'CALLED' || status === 'SERVING') return `A#${entry.id}`
  return `F#${entry.finishedAt ?? ''}#${entry.id}`
}
export const WAITING_PREFIX = 'W#'
export const IN_SERVICE_PREFIX = 'A#'
export const finishedSk = (finishedAt: string) => `F#${finishedAt}`

/** Los eventos de una cola, en su propia partición y ordenados por versión de la cola. */
export const eventsPk = (queueId: string) => `QUEUE#${queueId}#EV`
export const eventSk = (version: number, index: number, eventId: string) =>
  `${String(version).padStart(12, '0')}#${String(index).padStart(3, '0')}#${eventId}`

/** Ticket → cola y entrada. Inmutable: se escribe al unirse y no cambia más. */
export const ticketPk = (token: string) => `TICKET#${token}`
export const TICKET_SK = 'TICKET'

/** Entrada → cola y SK actual. Se actualiza en la misma transacción cada vez que la entrada se mueve. */
export const entryPk = (entryId: string) => `ENTRY#${entryId}`
export const ENTRY_REF_SK = 'REF'
export const notificationSk = (type: string, cycle: number) => `NOTIF#${type}#${cycle}`

export const establishmentPk = (establishmentId: string) => `EST#${establishmentId}`
export const ESTABLISHMENT_META_SK = 'META'
export const establishmentQueueSk = (queueId: string) => `QUEUE#${queueId}`
export const memberSk = (userId: string) => `MEMBER#${userId}`

/** Las membresías de un usuario, por el `sub` de Cognito. */
export const userPk = (userId: string) => `USER#${userId}`
export const membershipSk = (establishmentId: string) => `EST#${establishmentId}`

/** Un ticket de un solo uso para que el staff abra el WebSocket sin poner su token en la URL. */
export const wsTicketPk = (id: string) => `WSTICKET#${id}`
export const WS_TICKET_SK = 'WSTICKET'

export const ratePk = (ip: string, minute: string) => `RATE#${ip}#${minute}`
export const RATE_SK = 'RATE'

/** Segundos desde epoch, el formato que exige el TTL de DynamoDB. */
export const epochSeconds = (date: Date) => Math.floor(date.getTime() / 1000)
