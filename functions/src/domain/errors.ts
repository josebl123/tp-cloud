// Errores del dominio con el mismo `code` estable que expone hoy la API (RFC 7807): el frontend
// ramifica por el código, no por el texto, así que conservarlos evita tocar la SPA.

export type ErrorKind = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN'

const STATUS_BY_KIND: Record<ErrorKind, number> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
}

export class DomainError extends Error {
  readonly status: number

  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DomainError'
    this.status = STATUS_BY_KIND[kind]
  }
}

export const validation = (code: string, message: string) => new DomainError('VALIDATION', code, message)
export const conflict = (code: string, message: string) => new DomainError('CONFLICT', code, message)
export const notFound = (code: string, message: string) => new DomainError('NOT_FOUND', code, message)
export const forbidden = (code: string, message: string) => new DomainError('FORBIDDEN', code, message)
