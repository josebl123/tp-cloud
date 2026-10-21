import { describe, expect, it } from 'vitest'
import { DIGITS, keyBetween, keyForPositionBack, keyForSequence } from '../../src/domain/ordering.js'

describe('claves de orden', () => {
  it('las claves del final crecen con la secuencia y tienen largo fijo', () => {
    const keys = [0, 1, 61, 62, 63, 1000, 238_327, 999_999].map(keyForSequence)
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys.map((key) => key.length)).size).toBe(1)
  })

  it('ninguna clave del final termina en 0', () => {
    for (const sequence of [0, 62, 3844, 62 ** 3]) expect(keyForSequence(sequence).endsWith('0')).toBe(false)
  })

  it('el punto medio queda estrictamente entre los vecinos', () => {
    const lower = keyForSequence(3)
    const upper = keyForSequence(4)
    const middle = keyBetween(lower, upper)
    expect(middle > lower && middle < upper).toBe(true)
  })

  it('se puede insertar entre los mismos vecinos indefinidamente: no hace falta renormalizar', () => {
    // La versión con enteros separados de a 1000 se quedaba sin lugar a las ~10 inserciones.
    let lower = keyForSequence(1)
    const upper = keyForSequence(2)
    for (let i = 0; i < 200; i++) {
      const middle = keyBetween(lower, upper)
      expect(middle > lower && middle < upper).toBe(true)
      lower = middle
    }
    expect(lower.length).toBeLessThan(220)
  })

  it('también inserta pegado al vecino de abajo', () => {
    const lower = keyForSequence(1)
    let upper = keyForSequence(2)
    for (let i = 0; i < 100; i++) {
      const middle = keyBetween(lower, upper)
      expect(middle > lower && middle < upper).toBe(true)
      upper = middle
    }
  })

  it('el orden de los strings es el de DynamoDB: por código de carácter', () => {
    expect([...DIGITS].sort().join('')).toBe(DIGITS)
  })

  it('rechaza vecinos desordenados', () => {
    expect(() => keyBetween(keyForSequence(5), keyForSequence(5))).toThrow(RangeError)
    expect(() => keyBetween(keyForSequence(6), keyForSequence(5))).toThrow(RangeError)
  })
})

describe('keyForPositionBack', () => {
  const line = [1, 2, 3, 4].map((sequence) => ({ orderKey: keyForSequence(sequence) }))
  const end = () => keyForSequence(99)

  it('queda detrás de exactamente N personas', () => {
    const key = keyForPositionBack(line, 2, end)
    expect(line.filter((other) => other.orderKey < key)).toHaveLength(2)
  })

  it('pedir más lugares que la fila lo manda al final', () => {
    expect(keyForPositionBack(line, 10, end)).toBe(end())
  })

  it('una fila vacía lo manda al final', () => {
    expect(keyForPositionBack([], 3, end)).toBe(end())
  })

  it('cero o menos cuenta como uno', () => {
    const key = keyForPositionBack(line, 0, end)
    expect(line.filter((other) => other.orderKey < key)).toHaveLength(1)
  })
})
