import { GenericContainer, Wait } from 'testcontainers'
import type { StartedTestContainer } from 'testcontainers'
import type { TestProject } from 'vitest/node'

// Un solo DynamoDB Local para todos los archivos de integración. Cada archivo crea su propia tabla,
// así que corren en paralelo sin pisarse.

declare module 'vitest' {
  export interface ProvidedContext {
    dynamodbEndpoint: string
  }
}

export const DYNAMODB_LOCAL_IMAGE = 'amazon/dynamodb-local:3.3.1'

let container: StartedTestContainer | undefined

export async function setup(project: TestProject): Promise<void> {
  container = await new GenericContainer(DYNAMODB_LOCAL_IMAGE)
    // -inMemory: nada que limpiar al terminar. -sharedDb: una sola base para cualquier región y clave.
    .withCommand(['-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb'])
    .withExposedPorts(8000)
    .withWaitStrategy(Wait.forListeningPorts())
    .start()
  project.provide('dynamodbEndpoint', `http://${container.getHost()}:${container.getMappedPort(8000)}`)
}

export async function teardown(): Promise<void> {
  await container?.stop()
}
