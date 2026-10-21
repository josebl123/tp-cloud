import { describe, expect, it } from 'vitest'
import type { Transport } from '../../src/notifications/smtp.js'
import { secretPassword, SmtpMailer } from '../../src/notifications/smtp.js'

// El SMTP de Gmail con un transporte falso y un Secrets Manager falso: nada sale a la red.

const SENDER = 'grupo@example.com'

function fakeTransport() {
  const sent: Parameters<Transport['sendMail']>[0][] = []
  const created: { user: string; password: string }[] = []
  const factory = (user: string, password: string): Transport => {
    created.push({ user, password })
    return {
      async sendMail(message) {
        sent.push(message)
        return {}
      },
    }
  }
  return { sent, created, factory }
}

/** Un Secrets Manager que responde lo que diga `value` en cada llamada, y cuenta las llamadas. */
function fakeSecrets(value: () => string | Error) {
  const calls = { count: 0 }
  const client = {
    async send() {
      calls.count++
      const current = value()
      if (current instanceof Error) throw current
      return { SecretString: current }
    },
  }
  return { calls, client: client as never }
}

const noVersion = () => Object.assign(new Error("Secrets Manager can't find the specified secret value"), { name: 'ResourceNotFoundException' })

describe('SMTP de Gmail', () => {
  it('manda desde el mail del grupo, con la contraseña del secreto y sin sus espacios', async () => {
    const transport = fakeTransport()
    const secrets = fakeSecrets(() => 'abcd efgh ijkl mnop')
    const mailer = new SmtpMailer(SENDER, secretPassword('q-smtp', secrets.client), transport.factory)

    expect(await mailer.send('ana@example.com', 'Tu turno', 'Hola')).toBe('sent')
    expect(await mailer.send('beto@example.com', 'Tu turno', 'Hola')).toBe('sent')

    expect(transport.created).toEqual([{ user: SENDER, password: 'abcdefghijklmnop' }])
    expect(transport.sent.map((mail) => [mail.from.address, mail.to, mail.subject, mail.text])).toEqual([
      [SENDER, 'ana@example.com', 'Tu turno', 'Hola'],
      [SENDER, 'beto@example.com', 'Tu turno', 'Hola'],
    ])
    // La contraseña presente se guarda: un solo pedido a Secrets Manager.
    expect(secrets.calls.count).toBe(1)
  })

  it('simula mientras el secreto no tiene valor, y manda en cuanto lo tiene', async () => {
    let value: string | Error = noVersion()
    const transport = fakeTransport()
    const secrets = fakeSecrets(() => value)
    const mailer = new SmtpMailer(SENDER, secretPassword('q-smtp', secrets.client), transport.factory)

    expect(await mailer.send('ana@example.com', 's', 'b')).toBe('simulated')
    value = ''
    expect(await mailer.send('ana@example.com', 's', 'b')).toBe('simulated')
    value = 'clave'
    expect(await mailer.send('ana@example.com', 's', 'b')).toBe('sent')
    expect(transport.sent).toHaveLength(1)
  })

  it('una contraseña incorrecta o un error de Secrets Manager no se simulan: fallan', async () => {
    const rejecting = new SmtpMailer(SENDER, async () => 'mala', () => ({
      sendMail: async () => Promise.reject(Object.assign(new Error('Invalid login'), { code: 'EAUTH' })),
    }))
    await expect(rejecting.send('ana@example.com', 's', 'b')).rejects.toThrow('Invalid login')

    const denied = secretPassword('q-smtp', fakeSecrets(() => Object.assign(new Error('denied'), { name: 'AccessDeniedException' })).client)
    await expect(new SmtpMailer(SENDER, denied, fakeTransport().factory).send('ana@example.com', 's', 'b')).rejects.toThrow('denied')
  })

  it('si cambia la contraseña, arma un transporte nuevo', async () => {
    let password = 'vieja'
    const transport = fakeTransport()
    const mailer = new SmtpMailer(SENDER, async () => password, transport.factory)
    await mailer.send('ana@example.com', 's', 'b')
    password = 'nueva'
    await mailer.send('ana@example.com', 's', 'b')
    expect(transport.created.map((created) => created.password)).toEqual(['vieja', 'nueva'])
  })
})
