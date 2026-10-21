// Los textos de los avisos, portados de i18n/notifications*.properties de la versión Java. Cada
// aviso sale en el idioma en que el cliente se unió: el email que le llega una hora después está en
// el mismo idioma que la página que leyó al tomar su lugar.

import type { DueNotification } from '../domain/notifications.js'
import type { Entry, NoShowPolicy, Queue, SupportedLocale } from '../domain/types.js'

type Messages = Record<string, string>

const EN: Messages = {
  'eta.soon': 'any moment now',
  'eta.minutes': 'about {0} minutes',
  'ticket-created.subject': "You're in the queue for {0}",
  'ticket-created.body':
    'Hi {0}, you have a place in the "{1}" queue at {2}.\n\nTicket number: {3}\nCurrent position: {4}\nEstimated wait: {5}\n\nFollow your turn live, and let us know if you leave:\n{6}',
  'your-turn.subject': "It's your turn at {0}",
  'your-turn.body': 'Hi {0}, it\'s your turn (ticket {1}) in "{2}" at {3}.\n\n{4}\n\n{5}',
  'your-turn.grace': 'You have {0} minutes to come over before you lose your place.',
  'your-turn.no-grace': "We're waiting for you.",
  'no-show.subject': 'We could not serve you at {0}',
  'no-show.body': 'Hi {0}, the time to come over for "{1}" ran out.\n\n{2}{3}\n\n{4}',
  'no-show.position': '\nYour new position is {0}.',
  'no-show.outcome.REMOVE': 'Unfortunately you have lost your place in the queue.',
  'no-show.outcome.MOVE_TO_END': 'We have moved you to the end of the queue.',
  'no-show.outcome.MOVE_BACK': 'We have moved you {0} places further back.',
  'no-show.outcome.KEEP_POSITION': 'You have kept your place in the queue.',
  'queue-closed.subject': 'The {0} queue has closed',
  'queue-closed.body': 'Hi {0}, the "{1}" queue at {2} has closed and your place is no longer active.\n\nSorry for the inconvenience.',
  'approaching-position.subject': 'Your turn at {0} is coming up',
  'approaching-position.body':
    'Hi {0}, there are {1} person(s) ahead of you in "{2}" at {3}.\n\nEstimated wait: {4} minute(s).\n{5}',
  'approaching-time.subject': 'About {0} minutes until your turn',
  'approaching-time.body': 'Hi {0}, your turn in "{1}" at {2} should come in about {3} minute(s).\n\nCurrent position: {4}.\n{5}',
}

const ES: Messages = {
  'eta.soon': 'en cualquier momento',
  'eta.minutes': 'unos {0} minutos',
  'ticket-created.subject': 'Ya tenés tu lugar en {0}',
  'ticket-created.body':
    'Hola {0}, ya tenés tu lugar en la fila "{1}" de {2}.\n\nNúmero de turno: {3}\nPosición actual: {4}\nEspera estimada: {5}\n\nSeguí tu turno en vivo y avisanos si te vas:\n{6}',
  'your-turn.subject': '¡Es tu turno en {0}!',
  'your-turn.body': 'Hola {0}, es tu turno (turno {1}) en "{2}" de {3}.\n\n{4}\n\n{5}',
  'your-turn.grace': 'Tenés {0} minutos para acercarte antes de perder tu lugar.',
  'your-turn.no-grace': 'Te esperamos.',
  'no-show.subject': 'No pudimos atenderte en {0}',
  'no-show.body': 'Hola {0}, se acabó el tiempo para acercarte a "{1}".\n\n{2}{3}\n\n{4}',
  'no-show.position': '\nTu nueva posición es {0}.',
  'no-show.outcome.REMOVE': 'Lamentablemente perdiste tu lugar en la fila.',
  'no-show.outcome.MOVE_TO_END': 'Te movimos al final de la fila.',
  'no-show.outcome.MOVE_BACK': 'Te movimos {0} lugares más atrás.',
  'no-show.outcome.KEEP_POSITION': 'Conservaste tu lugar en la fila.',
  'queue-closed.subject': 'Se cerró la fila de {0}',
  'queue-closed.body': 'Hola {0}, la fila "{1}" de {2} se cerró y tu lugar ya no está activo.\n\nPerdón por las molestias.',
  'approaching-position.subject': 'Se acerca tu turno en {0}',
  'approaching-position.body':
    'Hola {0}, hay {1} persona(s) delante tuyo en "{2}" de {3}.\n\nEspera estimada: {4} minuto(s).\n{5}',
  'approaching-time.subject': 'Faltan unos {0} minutos para tu turno',
  'approaching-time.body': 'Hola {0}, tu turno en "{1}" de {2} llegaría en unos {3} minuto(s).\n\nPosición actual: {4}.\n{5}',
}

const BUNDLES: Record<SupportedLocale, Messages> = { en: EN, es: ES }

/** Como MessageFormat: `{0}`, `{1}`… se reemplazan por los argumentos, en orden. */
export function text(locale: SupportedLocale, key: string, ...args: (string | number)[]): string {
  const template = BUNDLES[locale]?.[key] ?? EN[key] ?? key
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = args[Number(index)]
    return value === undefined ? match : String(value)
  })
}

export interface RenderContext {
  queue: Queue
  establishmentName: string
  ticketUrl: string
  /** Lugar en su carril, para el aviso de turno tomado. */
  lanePosition: number | null
}

/** El asunto y el cuerpo de un aviso, en el idioma de la entrada. */
export function render(due: DueNotification, context: RenderContext): { subject: string; body: string } {
  const entry: Entry = due.entry
  const { queue, establishmentName, ticketUrl } = context
  const t = (key: string, ...args: (string | number)[]) => text(entry.locale, key, ...args)
  const name = entry.customerName

  switch (due.type) {
    case 'TICKET_CREATED': {
      const minutes = due.estimatedMinutes ?? 0
      const eta = minutes <= 0 ? t('eta.soon') : t('eta.minutes', minutes)
      return {
        subject: t('ticket-created.subject', queue.name),
        body: t('ticket-created.body', name, queue.name, establishmentName, entry.ticketNumber, context.lanePosition ?? 1, eta, ticketUrl),
      }
    }
    case 'YOUR_TURN': {
      const grace =
        queue.gracePeriodSeconds > 0
          ? t('your-turn.grace', Math.max(1, Math.floor(queue.gracePeriodSeconds / 60)))
          : t('your-turn.no-grace')
      return {
        subject: t('your-turn.subject', queue.name),
        body: t('your-turn.body', name, entry.ticketNumber, queue.name, establishmentName, grace, ticketUrl),
      }
    }
    case 'NO_SHOW': {
      const policy: NoShowPolicy = queue.noShowPolicy
      const outcome = policy === 'MOVE_BACK' ? t('no-show.outcome.MOVE_BACK', queue.moveBackPositions) : t(`no-show.outcome.${policy}`)
      const position = due.newPosition === null ? '' : t('no-show.position', due.newPosition)
      return {
        subject: t('no-show.subject', queue.name),
        body: t('no-show.body', name, queue.name, outcome, position, ticketUrl),
      }
    }
    case 'QUEUE_CLOSED':
      return {
        subject: t('queue-closed.subject', queue.name),
        body: t('queue-closed.body', name, queue.name, establishmentName),
      }
    case 'APPROACHING_POSITION':
      return {
        subject: t('approaching-position.subject', queue.name),
        body: t('approaching-position.body', name, due.groupsAhead ?? 0, queue.name, establishmentName, due.estimatedMinutes ?? 0, ticketUrl),
      }
    case 'APPROACHING_TIME':
      return {
        subject: t('approaching-time.subject', due.estimatedMinutes ?? 0),
        body: t('approaching-time.body', name, queue.name, establishmentName, due.estimatedMinutes ?? 0, (due.groupsAhead ?? 0) + 1, ticketUrl),
      }
  }
}
