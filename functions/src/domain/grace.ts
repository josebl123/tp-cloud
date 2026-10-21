// El período de gracia: qué pasa con alguien que fue llamado y no se presentó.
//
// El vencimiento se evalúa en varios lugares a propósito (la cola SQS con delay, cualquier lectura y
// cualquier mutación del staff). Todos llegan acá, y como la persistencia condiciona la escritura a
// la versión de la cola, el primero gana y los demás se encuentran con que ya no hay nada vencido.

import { keyForPositionBack, keyForSequence } from './ordering.js'
import type { Actor, Session } from './state.js'
import { SYSTEM } from './state.js'
import type { Entry } from './types.js'
import { isActive } from './types.js'

/** La clave del final de la fila, consumiendo un número de la secuencia de la cola. */
export function allocateEndKey(session: Session): string {
  const key = keyForSequence(session.queue.nextOrderSequence)
  session.queue.nextOrderSequence += 1
  session.touchQueue()
  return key
}

/**
 * Cuántos vencimientos entran en una sesión. Cada uno escribe cuatro ítems (la entrada movida, su
 * referencia y el evento) y una transacción admite cien: sin tope, una cola con 25 llamados vencidos
 * no podría escribir nunca más, porque toda operación empieza venciendo a todos.
 */
export const MAX_EXPIRATIONS_PER_SESSION = 15

/**
 * Vence los llamados cuyo plazo ya pasó, los más viejos primero y a lo sumo
 * {@link MAX_EXPIRATIONS_PER_SESSION}. Los que queden los vence la próxima sesión. Devuelve si
 * cambió algo.
 */
export function expireDue(session: Session): boolean {
  const now = session.now.getTime()
  const due = session.state.entries
    .filter(
      (entry) =>
        entry.status === 'CALLED' && entry.graceExpiresAt !== null && Date.parse(entry.graceExpiresAt) <= now,
    )
    .sort((a, b) => Date.parse(a.graceExpiresAt ?? '') - Date.parse(b.graceExpiresAt ?? ''))
    .slice(0, MAX_EXPIRATIONS_PER_SESSION)
  for (const entry of due) applyNoShow(session, entry, SYSTEM)
  return due.length > 0
}

/** ¿Hay algún llamado vencido? Sirve para que una lectura decida si tiene que escribir. */
export function hasDueGrace(entries: readonly Entry[], now: Date): boolean {
  return entries.some(
    (entry) =>
      entry.status === 'CALLED' && entry.graceExpiresAt !== null && Date.parse(entry.graceExpiresAt) <= now.getTime(),
  )
}

/**
 * Aplica la política de ausencia de la cola a una entrada llamada.
 *
 * @returns la posición nueva desde 1, o null si la política la sacó de la fila
 */
export function applyNoShow(session: Session, entry: Entry, actor: Actor): number | null {
  const queue = session.queue
  const policy = queue.noShowPolicy

  entry.noShowCount += 1
  entry.graceExpiresAt = null

  let newPosition: number | null = null
  if (policy === 'REMOVE') {
    entry.status = 'NO_SHOW'
    entry.finishedAt = session.nowIso
  } else {
    // La fila en la que se la vuelve a ubicar, sin ella.
    const others = session.waiting().filter((candidate) => candidate.id !== entry.id)

    entry.status = 'WAITING'
    entry.calledAt = null
    entry.servingStartedAt = null
    entry.finishedAt = null
    // Una pasada nueva por la fila: los avisos de proximidad y de turno vuelven a corresponder.
    entry.notificationCycle += 1

    if (policy === 'MOVE_TO_END') {
      entry.orderKey = allocateEndKey(session)
    } else if (policy === 'MOVE_BACK') {
      // Las claves de los llamados también cuentan: si uno vuelve con KEEP_POSITION, reclama la suya.
      const taken = new Set(
        session.state.entries
          .filter((candidate) => candidate.id !== entry.id && isActive(candidate.status))
          .map((candidate) => candidate.orderKey),
      )
      entry.orderKey = keyForPositionBack(others, queue.moveBackPositions, () => allocateEndKey(session), taken)
    }
    // KEEP_POSITION: la clave que ya tenía la devuelve a su lugar.

    newPosition = others.filter((other) => other.orderKey < entry.orderKey).length + 1
  }

  session.touchEntry(entry)
  session.record('ENTRY_NO_SHOW', actor, entry, {
    policy,
    noShowCount: entry.noShowCount,
    newPosition,
  })
  return newPosition
}
