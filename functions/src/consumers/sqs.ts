// Lo común a los tres consumidores de SQS: procesar un lote y devolver solo los mensajes que
// fallaron. Lambda vuelve a poner en la cola esos y borra el resto (ReportBatchItemFailures): un
// mensaje problemático no hace reprocesar los que ya salieron bien.

import type { SQSBatchResponse, SQSRecord } from 'aws-lambda'

export async function processEach(records: readonly SQSRecord[], handle: (record: SQSRecord) => Promise<void>): Promise<SQSBatchResponse> {
  const failures: SQSBatchResponse['batchItemFailures'] = []
  for (const record of records) {
    try {
      await handle(record)
    } catch (error) {
      console.error('Falló el mensaje', record.messageId, error)
      failures.push({ itemIdentifier: record.messageId })
    }
  }
  return { batchItemFailures: failures }
}

export function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} no está configurada`)
  return value
}
