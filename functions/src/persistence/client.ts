import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import type { DynamoDBClientConfig } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

export interface TableConfig {
  documents: DynamoDBDocumentClient
  tableName: string
}

/**
 * El cliente de documentos de la tabla principal.
 *
 * En Lambda alcanza con `TABLE_NAME`: la región y las credenciales salen del entorno (LabRole). En
 * los tests, `DYNAMODB_ENDPOINT` apunta a DynamoDB Local.
 */
export function createTableConfig(options: { tableName?: string; endpoint?: string } = {}): TableConfig {
  const tableName = options.tableName ?? process.env.TABLE_NAME
  if (!tableName) throw new Error('TABLE_NAME no está configurada')

  const endpoint = options.endpoint ?? process.env.DYNAMODB_ENDPOINT
  const config: DynamoDBClientConfig = endpoint
    ? {
        endpoint,
        region: process.env.AWS_REGION ?? 'us-east-1',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
    : {}

  const documents = DynamoDBDocumentClient.from(new DynamoDBClient(config), {
    // `undefined` no existe en DynamoDB; `null` sí, y el dominio lo usa para "sin valor".
    marshallOptions: { removeUndefinedValues: true },
  })
  return { documents, tableName }
}
