// Lo que comparten todas las funciones detrás de API Gateway: leer el pedido, responder con la misma
// forma que la API Java (RFC 7807 en los errores, sin campos null) y enrutar por la ruta declarada.

import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { DomainError } from '../domain/errors.js'

/** Un error que ya sabe qué status y qué código devolver. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors?: Record<string, string>,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (code: string, message: string, errors?: Record<string, string>) =>
  new HttpError(400, code, message, errors)

/** Quién hace el pedido, según el token que ya validó el authorizer de Cognito en API Gateway. */
export interface Caller {
  /** `sub` de Cognito: el id estable del usuario. */
  sub: string
  email: string
  name: string
}

export interface Request {
  readonly event: APIGatewayProxyEvent
  readonly now: Date
  /** La raíz del sitio, con el stage: los links de los QR y de los tickets salen de acá. */
  readonly baseUrl: string
  /** La IP real del cliente, la que vio API Gateway. `X-Forwarded-For` lo puede inventar cualquiera. */
  readonly sourceIp: string
  param(name: string): string
  query(name: string): string | undefined
  body<T extends object>(): T
  caller(): Caller
}

export type Route = (request: Request) => Promise<APIGatewayProxyResult>

/** Rutas indexadas por `MÉTODO /ruta/{param}`, la plantilla que declara la API en API Gateway. */
export type Routes = Record<string, Route>

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
}

const NO_STORE = { 'Cache-Control': 'no-store' }

// La API Java omitía los campos null (Jackson `non_null`) y el frontend los trata como ausentes.
export const omitNulls = (key: string, value: unknown) => (value === null && key !== '' ? undefined : value)

export function json(status: number, body: unknown, headers: Record<string, string> = {}): APIGatewayProxyResult {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...NO_STORE, ...headers },
    body: JSON.stringify(body, omitNulls),
  }
}

export const ok = (body: unknown) => json(200, body)

export const created = (body: unknown, location?: string) =>
  json(201, body, location ? { Location: location } : {})

export const noContent = (): APIGatewayProxyResult => ({ statusCode: 204, headers: NO_STORE, body: '' })

/** Un binario: API Gateway lo decodifica antes de entregarlo porque `isBase64Encoded` es true. */
export function binary(contentType: string, data: Buffer, cacheControl: string): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl },
    body: data.toString('base64'),
    isBase64Encoded: true,
  }
}

export function problem(
  status: number,
  code: string,
  detail: string,
  instance: string,
  errors?: Record<string, string>,
): APIGatewayProxyResult {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/problem+json', ...NO_STORE },
    body: JSON.stringify({
      type: `https://q.itba.ar/problems/${code.toLowerCase().replaceAll('_', '-')}`,
      title: TITLES[status] ?? 'Error',
      status,
      detail,
      instance,
      code,
      timestamp: new Date().toISOString(),
      ...(errors ? { errors } : {}),
    }),
  }
}

function toRequest(event: APIGatewayProxyEvent, now: Date): Request {
  const context = event.requestContext
  let parsed: unknown
  let parsedOnce = false

  return {
    event,
    now,
    baseUrl: `https://${context.domainName}/${context.stage}`,
    sourceIp: context.identity?.sourceIp ?? 'unknown',

    param(name) {
      const value = event.pathParameters?.[name]
      if (!value) throw new HttpError(404, 'NOT_FOUND', `Missing path parameter ${name}`)
      return value
    },

    query(name) {
      return event.queryStringParameters?.[name] ?? undefined
    },

    body<T extends object>(): T {
      if (!parsedOnce) {
        parsedOnce = true
        if (!event.body) {
          parsed = {}
        } else {
          // Con `binary_media_types = ["*/*"]`, API Gateway entrega en base64 también los JSON.
          const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
          try {
            parsed = JSON.parse(text)
          } catch {
            throw badRequest('MALFORMED_JSON', 'The request body is not valid JSON')
          }
        }
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw badRequest('MALFORMED_JSON', 'The request body must be a JSON object')
      }
      return parsed as T
    },

    caller() {
      const claims = (context.authorizer?.['claims'] ?? {}) as Record<string, string | undefined>
      const sub = claims['sub']
      if (!sub) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required')
      return { sub, email: claims['email'] ?? '', name: claims['name'] ?? claims['email'] ?? '' }
    },
  }
}

/**
 * La función que recibe API Gateway. Busca la ruta por la plantilla declarada (`event.resource`),
 * así no hace falta un enrutador con expresiones regulares: el ruteo ya lo hizo API Gateway.
 */
export function router(routes: Routes, options: { now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date())

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const instance = event.path
    const route = routes[`${event.httpMethod} ${event.resource}`]
    if (!route) return problem(404, 'NOT_FOUND', `No route for ${event.httpMethod} ${event.resource}`, instance)

    try {
      return await route(toRequest(event, now()))
    } catch (error) {
      if (error instanceof DomainError || error instanceof HttpError) {
        return problem(error.status, error.code, error.message, instance, error instanceof HttpError ? error.errors : undefined)
      }
      // La versión de la cola la resuelve la persistencia reintentando. Si una transacción cae por
      // otra condición (un movimiento que pisaría una entrada, un ticket repetido), también es una
      // carrera perdida: el cliente puede reintentar, no es un error del servidor.
      if (error instanceof TransactionCanceledException) {
        console.warn('Transacción cancelada', error.CancellationReasons)
        return problem(409, 'CONCURRENT_MODIFICATION', 'The queue changed while this operation ran. Please try again.', instance)
      }
      console.error('Error no controlado', error)
      return problem(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.', instance)
    }
  }
}
