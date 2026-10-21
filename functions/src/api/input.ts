// Lo que llega en el body de los pedidos del staff, con el tipo verificado campo por campo antes de
// pasarlo al dominio. El dominio valida rangos y reglas; acá solo se garantiza que un número sea un
// número y un enum sea uno de sus valores, así un `"maxSize": "mucho"` responde 400 y no rompe nada.

import { badRequest } from '../http/api.js'
import type { LaneSettings, QueueSettings } from '../domain/queues.js'
import type { CallStrategy, Lane, LaneCapacityMode, MembershipRole, NoShowPolicy } from '../domain/types.js'

type Body = Record<string, unknown>

const NO_SHOW_POLICIES: readonly NoShowPolicy[] = ['KEEP_POSITION', 'MOVE_BACK', 'MOVE_TO_END', 'REMOVE']
const CALL_STRATEGIES: readonly CallStrategy[] = ['GLOBAL_AGE', 'LANE_PRIORITY', 'ROUND_ROBIN']
const CAPACITY_MODES: readonly LaneCapacityMode[] = ['PERSONS', 'GROUPS']
const ROLES: readonly MembershipRole[] = ['OWNER', 'STAFF']
const EMAIL_PATTERN = /^[^\s@"]+@[^\s@"]+\.[^\s@"]+$/

/** Junta todos los campos con problemas y los devuelve en un solo 400, como la API Java. */
class Checker {
  readonly errors: Record<string, string> = {}

  constructor(private readonly body: Body) {}

  has(field: string): boolean {
    return this.body[field] !== undefined
  }

  string(field: string, max: number): string | undefined {
    const value = this.body[field]
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string') return this.fail(field, 'must be a string')
    if (value.trim().length > max) return this.fail(field, `must have at most ${max} characters`)
    return value
  }

  number(field: string): number | undefined {
    const value = this.body[field]
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'number' || !Number.isFinite(value)) return this.fail(field, 'must be a number')
    return value
  }

  /** `null` explícito significa "sin valor"; ausente, "no se toca". */
  nullableNumber(field: string): number | null | undefined {
    if (this.body[field] === null) return null
    return this.number(field)
  }

  boolean(field: string): boolean | undefined {
    const value = this.body[field]
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'boolean') return this.fail(field, 'must be true or false')
    return value
  }

  oneOf<T extends string>(field: string, allowed: readonly T[]): T | undefined {
    const value = this.body[field]
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string' || !allowed.includes(value as T)) return this.fail(field, `must be one of ${allowed.join(', ')}`)
    return value as T
  }

  require<T>(field: string, value: T | undefined): T | undefined {
    if (value === undefined && this.errors[field] === undefined) this.fail(field, 'is required')
    return value
  }

  fail(field: string, message: string): undefined {
    this.errors[field] = message
    return undefined
  }

  done(): void {
    if (Object.keys(this.errors).length > 0) {
      throw badRequest('VALIDATION_FAILED', 'One or more fields are invalid', this.errors)
    }
  }
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export function readEstablishmentInput(body: Body, options: { requireName: boolean }) {
  const check = new Checker(body)
  const rawName = check.string('name', 120)?.trim()
  const name = rawName ? rawName : undefined
  if (options.requireName) check.require('name', name)
  else if (rawName !== undefined && !rawName) check.fail('name', 'must not be empty')
  const timezone = check.string('timezone', 64)?.trim()
  if (timezone !== undefined && !validTimezone(timezone)) check.fail('timezone', 'must be an IANA time zone')
  check.done()
  return { name, timezone }
}

export function readMemberInput(body: Body) {
  const check = new Checker(body)
  const email = check.require('email', check.string('email', 254)?.trim().toLowerCase())
  if (email !== undefined && !EMAIL_PATTERN.test(email)) check.fail('email', 'must be a valid email address')
  const password = check.string('password', 256)
  if (password !== undefined && password.length < 8) check.fail('password', 'must have at least 8 characters')
  const displayName = check.string('displayName', 120)?.trim() || undefined
  const role = check.oneOf('role', ROLES) ?? 'STAFF'
  check.done()
  return { email: email ?? '', password, displayName, role }
}

/**
 * La configuración de una cola. En un PATCH, los tres valores que pueden quedar vacíos se vacían con
 * `clearMaxSize`, `clearNotifyAtPosition` y `clearNotifyAtMinutes`: un `null` suelto no alcanza para
 * distinguir "vaciarlo" de "no tocarlo", y es lo que ya manda el frontend.
 */
export function queueSettings(body: Body, options: { creating: boolean }): QueueSettings {
  const check = new Checker(body)
  const settings: QueueSettings = {}

  const name = check.string('name', 120)
  if (options.creating) check.require('name', name?.trim() ? name : undefined)
  if (name !== undefined) settings.name = name

  const description = check.string('description', 500)
  if (description !== undefined) settings.description = description

  for (const field of ['serviceStations', 'defaultServiceMinutes', 'gracePeriodSeconds', 'moveBackPositions'] as const) {
    const value = check.number(field)
    if (value !== undefined) settings[field] = value
  }

  const clearable = {
    maxSize: 'clearMaxSize',
    notifyAtPosition: 'clearNotifyAtPosition',
    notifyAtMinutes: 'clearNotifyAtMinutes',
  } as const
  for (const [field, flag] of Object.entries(clearable) as [keyof typeof clearable, string][]) {
    const value = check.number(field)
    if (check.boolean(flag) === true) settings[field] = null
    else if (value !== undefined) settings[field] = value
  }

  const noShowPolicy = check.oneOf('noShowPolicy', NO_SHOW_POLICIES)
  if (noShowPolicy !== undefined) settings.noShowPolicy = noShowPolicy
  const callStrategy = check.oneOf('callStrategy', CALL_STRATEGIES)
  if (callStrategy !== undefined) settings.callStrategy = callStrategy
  const requirePartySize = check.boolean('requirePartySize')
  if (requirePartySize !== undefined) settings.requirePartySize = requirePartySize

  check.done()
  return settings
}

/**
 * Un carril. Al crearlo, nombre, tamaño mínimo y prioridad son obligatorios. En un PATCH lo que no
 * viene conserva el valor de `current`, y un `null` explícito en `maxPartySize` o `maxSize` lo deja
 * sin tope, que es como lo manda el frontend.
 */
export function laneSettings(body: Body, current: Lane | null): LaneSettings {
  const check = new Checker(body)
  const name = check.string('name', 120)
  const minPartySize = check.number('minPartySize')
  const priority = check.number('priority')
  const maxPartySize = check.nullableNumber('maxPartySize')
  const maxSize = check.nullableNumber('maxSize')
  const capacityMode = check.oneOf('capacityMode', CAPACITY_MODES)
  const timeFactor = check.number('timeFactor')
  const active = check.boolean('active')

  if (current === null) {
    check.require('name', name)
    check.require('minPartySize', minPartySize)
    check.require('priority', priority)
  }
  check.done()

  const pick = <T>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value)
  return {
    name: pick(name, current?.name ?? ''),
    minPartySize: pick(minPartySize, current?.minPartySize ?? 1),
    maxPartySize: pick(maxPartySize, current?.maxPartySize ?? null),
    priority: pick(priority, current?.priority ?? 0),
    capacityMode: pick(capacityMode, current?.capacityMode ?? 'GROUPS'),
    maxSize: pick(maxSize, current?.maxSize ?? null),
    timeFactor: pick(timeFactor, current?.timeFactor ?? 1),
    active: pick(active, current?.active ?? true),
  }
}
