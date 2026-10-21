// Claves de orden fraccionarias.
//
// La fila es la lista de entradas que esperan ordenada por `orderKey`, y la posición de alguien es su
// índice en esa lista: nunca se guarda. La versión Java usaba enteros separados de a 1000 y, cuando
// dos vecinos quedaban pegados, reescribía toda la fila. En DynamoDB eso sería caro (una transacción
// admite 100 ítems), así que acá las claves son strings: entre dos strings siempre existe otro, y
// la renormalización desaparece.
//
// Dos clases de clave:
// - Al final: la secuencia de la cola en base 62 con ancho fijo, más un sufijo. Son cortas y crecen
//   con la secuencia, así que entrar al final nunca alarga las claves.
// - Entre dos vecinos: el punto medio lexicográfico, que agrega como mucho un carácter por inserción
//   entre los mismos vecinos.
//
// Las comparaciones son por código de carácter (`<` de JavaScript), que es exactamente como DynamoDB
// ordena una clave de ordenamiento de tipo string: el orden de la consulta es el orden de la fila.

export const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length
const SEQUENCE_WIDTH = 8
/** Sufijo de las claves del final. Hace que ninguna termine en '0', que el punto medio no admite. */
const END_SUFFIX = 'V'

/** Clave que ordena después de cualquiera emitida antes con una secuencia menor. */
export function keyForSequence(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError(`secuencia inválida: ${sequence}`)
  }
  let digits = ''
  let rest = sequence
  do {
    digits = DIGITS.charAt(rest % BASE) + digits
    rest = Math.floor(rest / BASE)
  } while (rest > 0)
  if (digits.length > SEQUENCE_WIDTH) throw new RangeError('secuencia fuera de rango')
  return digits.padStart(SEQUENCE_WIDTH, '0') + END_SUFFIX
}

/**
 * Una clave estrictamente entre `lower` y `upper`. `upper` en null significa "sin límite superior".
 *
 * Es el algoritmo de punto medio sobre fracciones en base 62 (el de la librería fractional-indexing,
 * sin su parte entera, que acá cubren las claves de secuencia).
 */
export function keyBetween(lower: string, upper: string | null): string {
  if (upper !== null && lower >= upper) {
    throw new RangeError(`"${lower}" no es menor que "${upper}"`)
  }
  if (lower.endsWith('0') || (upper !== null && upper.endsWith('0'))) {
    throw new RangeError('una clave no puede terminar en 0')
  }
  return midpoint(lower, upper)
}

function midpoint(lower: string, upper: string | null): string {
  if (upper !== null) {
    // Prefijo común: la clave nueva lo comparte y se decide en el primer carácter distinto.
    let common = 0
    while ((lower[common] ?? '0') === upper[common]) common++
    if (common > 0) {
      return upper.slice(0, common) + midpoint(lower.slice(common), upper.slice(common))
    }
  }

  const lowerDigit = lower.length > 0 ? DIGITS.indexOf(lower.charAt(0)) : 0
  const upperDigit = upper !== null ? DIGITS.indexOf(upper.charAt(0)) : BASE
  if (upperDigit - lowerDigit > 1) {
    return DIGITS.charAt(Math.round((lowerDigit + upperDigit) / 2))
  }
  // Dígitos contiguos: si el superior tiene más caracteres, su primer dígito solo ya queda en el
  // medio; si no, se baja un nivel detrás del dígito inferior.
  if (upper !== null && upper.length > 1) {
    return upper.slice(0, 1)
  }
  return DIGITS.charAt(lowerDigit) + midpoint(lower.slice(1), null)
}

interface Ordered {
  orderKey: string
}

/**
 * Clave que deja exactamente `positionsBack` personas de `waiting` adelante.
 *
 * El punto medio es determinista: dos inserciones entre los mismos vecinos darían la misma clave.
 * Eso importa porque un llamado conserva su clave mientras no está en la fila, y si vuelve con
 * KEEP_POSITION la reclama. Por eso `taken` lleva las claves de todas las entradas activas, y si el
 * punto medio coincide con una, se sigue bajando entre el vecino de abajo y esa clave: el resultado
 * sigue quedando entre los mismos vecinos de la fila.
 *
 * @param waiting la fila en orden, sin la entrada que se está ubicando
 * @param endKey  la clave del final, por si la posición pedida queda al fondo
 * @param taken   claves que ya tiene alguna entrada activa (en la fila o llamada)
 */
export function keyForPositionBack(
  waiting: readonly Ordered[],
  positionsBack: number,
  endKey: () => string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const target = Math.max(1, positionsBack)
  if (waiting.length === 0 || target >= waiting.length) return endKey()
  const lower = waiting[target - 1]
  const upper = waiting[target]
  if (!lower || !upper) return endKey()
  let key = keyBetween(lower.orderKey, upper.orderKey)
  while (taken.has(key)) key = keyBetween(lower.orderKey, key)
  return key
}

/** Orden de la fila: por clave, y por hora de entrada si alguna vez coincidieran. */
export function compareByOrder(a: Ordered & { joinedAt: string }, b: Ordered & { joinedAt: string }): number {
  if (a.orderKey !== b.orderKey) return a.orderKey < b.orderKey ? -1 : 1
  if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt ? -1 : 1
  return 0
}
