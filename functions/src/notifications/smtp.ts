// Los avisos por el SMTP de Gmail, en lugar de SES.
//
// El Learner Lab niega SES entero: ni el rol del pipeline ni LabRole pueden verificar una identidad ni
// mandar. Gmail sí acepta conexiones salientes desde Lambda, con el mail del grupo como remitente y una
// contraseña de aplicación de esa cuenta. Es el único secreto del sistema: vive cifrado en Secrets
// Manager, el pipeline le escribe el valor con la CLI (nunca pasa por Terraform, ni por el plan ni por
// el estado) y esta función lo lee al mandar.

import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import nodemailer from 'nodemailer'
import type { Mailer } from '../handlers/notifier.js'

/** Lo único que se usa del transporte de nodemailer: los tests lo reemplazan por uno falso. */
export interface Transport {
  sendMail(message: { from: { name: string; address: string }; to: string; subject: string; text: string }): Promise<unknown>
}

export type TransportFactory = (user: string, password: string) => Transport

/** Gmail por TLS directo (465), con timeouts holgados dentro de los 30 s de la función. */
export const gmailTransport: TransportFactory = (user, password) =>
  nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })

/**
 * Lee la contraseña del secreto. `null` mientras el secreto exista sin valor: el apply lo crea vacío y
 * el pipeline le escribe el valor después, así que un aviso puede llegar en el medio. Solo se guarda
 * un valor presente; la falta de valor se vuelve a consultar en el próximo envío.
 */
export function secretPassword(secretId: string, client: Pick<SecretsManagerClient, 'send'>): () => Promise<string | null> {
  let cached: string | null = null
  return async () => {
    if (cached) return cached
    try {
      const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
      // Google muestra la contraseña de aplicación en grupos de cuatro: los espacios no son parte.
      const value = result.SecretString?.replace(/\s+/g, '') ?? ''
      cached = value || null
      return cached
    } catch (error) {
      // Un secreto sin ninguna versión responde así.
      if (error instanceof Error && error.name === 'ResourceNotFoundException') return null
      throw error
    }
  }
}

export class SmtpMailer implements Mailer {
  readonly channel = 'EMAIL' as const
  private transport: { password: string; transport: Transport } | null = null

  constructor(
    private readonly sender: string,
    private readonly password: () => Promise<string | null>,
    private readonly createTransport: TransportFactory = gmailTransport,
  ) {}

  async send(to: string, subject: string, body: string): Promise<'sent' | 'simulated'> {
    const password = await this.password()
    if (!password) {
      console.log(JSON.stringify({ emailSimulado: { reason: 'sin contraseña SMTP cargada', to, subject, body } }))
      return 'simulated'
    }
    if (this.transport?.password !== password) {
      this.transport = { password, transport: this.createTransport(this.sender, password) }
    }
    // Una contraseña incorrecta o Gmail caído llegan como excepción: el aviso queda FAILED y se
    // reintenta, y si nunca sale termina en la DLQ, con su alarma.
    await this.transport.transport.sendMail({ from: { name: 'Queue', address: this.sender }, to, subject, text: body })
    return 'sent'
  }
}
