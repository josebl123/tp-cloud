// λ notifier: consume q-notifications y manda los avisos que corresponden.
//
// Qué avisar se decide con el estado actual de la cola, no con el evento: cualquier movimiento puede
// hacer que alguien cruce un umbral ("faltan 3 personas"). Por eso no importan el orden ni los
// duplicados: dos evaluaciones del mismo estado producen los mismos avisos, y la reserva condicional
// de `NOTIF#type#cycle` evita el segundo envío.

import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'
import { ticketUrl } from '../api/views.js'
import { processEach, required } from '../consumers/sqs.js'
import type { DueNotification } from '../domain/notifications.js'
import { dueForEvent, dueThresholds } from '../domain/notifications.js'
import type { NotificationRecord } from '../domain/types.js'
import { snapshot } from '../domain/views.js'
import type { PublishedEvent } from './stream-publisher.js'
import { secretPassword, SmtpMailer } from '../notifications/smtp.js'
import { render } from '../notifications/templates.js'
import { createTableConfig } from '../persistence/client.js'
import { DirectoryStore } from '../persistence/directory-store.js'
import { QueueStore } from '../persistence/queue-store.js'

export interface Mailer {
  readonly channel: NotificationRecord['channel']
  /** `simulated` si el email no salió pero no hay que reintentarlo (sin remitente, o sandbox de SES). */
  send(to: string, subject: string, body: string): Promise<'sent' | 'simulated'>
}

export interface NotifierDependencies {
  queues: QueueStore
  directory: DirectoryStore
  mailer: Mailer
  siteUrl: string
  now?: () => Date
}

/** Evalúa y manda los avisos que dispara un evento. Devuelve cuántos se enviaron o simularon. */
export async function notify(event: PublishedEvent, deps: NotifierDependencies): Promise<number> {
  const state = await deps.queues.read(event.queueId, { entryIds: event.entryId ? [event.entryId] : [] })
  const establishmentName = (await deps.directory.establishment(state.queue.establishmentId))?.name ?? ''
  const snap = snapshot(state)

  const due: DueNotification[] = []
  const entry = event.entryId ? state.entries.find((candidate) => candidate.id === event.entryId) : undefined
  if (entry) {
    const direct = dueForEvent(event, entry, snap.simulations.get(entry.id))
    if (direct) due.push(direct)
  }
  due.push(...dueThresholds(state.queue, snap.waiting, snap.simulations))

  let delivered = 0
  for (const notice of due) {
    const destination = notice.entry.customerEmail
    // Quien dejó solo un teléfono no tiene canal: no hay SMS en esta entrega.
    if (!destination) continue

    const now = deps.now?.() ?? new Date()
    const { subject, body } = render(notice, {
      queue: state.queue,
      establishmentName,
      ticketUrl: ticketUrl(deps.siteUrl, notice.entry.ticketToken),
      lanePosition: snap.simulations.get(notice.entry.id)?.lanePosition ?? null,
    })
    const record: NotificationRecord = {
      entryId: notice.entry.id,
      type: notice.type,
      cycle: notice.cycle,
      status: 'PENDING',
      channel: deps.mailer.channel,
      destination,
      attempts: 0,
      createdAt: now.toISOString(),
      sentAt: null,
      failureReason: null,
      subject,
    }
    if (!(await deps.directory.claimNotification(record, now))) continue

    try {
      const outcome = await deps.mailer.send(destination, subject, body)
      // Un aviso simulado (sin remitente, o un destinatario fuera del sandbox de SES) no salió por mail.
      await deps.directory.markNotification(notice.entry.id, notice.type, notice.cycle, {
        status: 'SENT',
        at: now.toISOString(),
        channel: outcome === 'simulated' ? 'LOG' : 'EMAIL',
      })
      delivered++
    } catch (error) {
      await deps.directory.markNotification(notice.entry.id, notice.type, notice.cycle, {
        status: 'FAILED',
        reason: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
      })
      // Que el mensaje vuelva a la cola: el próximo intento retoma el aviso FAILED.
      throw error
    }
  }
  return delivered
}

/**
 * SES. Sin remitente configurado, o con un destinatario que el sandbox de SES rechaza por no estar
 * verificado, el email se escribe en los logs en lugar de mandarse: es un envío simulado, que la
 * consigna permite, y no se reintenta.
 */
export class SesMailer implements Mailer {
  readonly channel: NotificationRecord['channel']

  constructor(
    private readonly sender: string | null,
    private readonly client = new SESv2Client({}),
  ) {
    this.channel = sender ? 'EMAIL' : 'LOG'
  }

  async send(to: string, subject: string, body: string): Promise<'sent' | 'simulated'> {
    if (!this.sender) return this.simulate(to, subject, body, 'sin remitente configurado')
    try {
      await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.sender,
          Destination: { ToAddresses: [to] },
          Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: body, Charset: 'UTF-8' } } } },
        }),
      )
      return 'sent'
    } catch (error) {
      if (error instanceof Error && error.name === 'MessageRejected' && /not verified/i.test(error.message)) {
        return this.simulate(to, subject, body, 'destinatario no verificado en el sandbox de SES')
      }
      throw error
    }
  }

  private simulate(to: string, subject: string, body: string, reason: string): 'simulated' {
    console.log(JSON.stringify({ emailSimulado: { reason, to, subject, body } }))
    return 'simulated'
  }
}

/**
 * Gmail si el despliegue trae su remitente y su secreto (el caso del Learner Lab, que niega SES); si
 * no, SES, que sin remitente simula el envío.
 */
function chooseMailer(): Mailer {
  const smtpSender = process.env.SMTP_SENDER
  const smtpSecret = process.env.SMTP_SECRET_ID
  if (smtpSender && smtpSecret) return new SmtpMailer(smtpSender, secretPassword(smtpSecret, new SecretsManagerClient({})))
  return new SesMailer(process.env.SENDER_EMAIL || null)
}

let deps: NotifierDependencies | undefined

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  if (!deps) {
    const main = createTableConfig()
    deps = {
      queues: new QueueStore(main),
      directory: new DirectoryStore(main),
      mailer: chooseMailer(),
      siteUrl: required('SITE_URL'),
    }
  }
  const ready = deps
  return processEach(event.Records, async (record) => {
    await notify(JSON.parse(record.body) as PublishedEvent, ready)
  })
}
