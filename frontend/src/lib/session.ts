'use client'

/**
 * Where the staff bearer token lives.
 *
 * Kept in `localStorage` because the app is a static SPA with no server of its own to hold a session
 * cookie. The token is short-lived (12h) and scoped to staff actions; customers never have one, so
 * nothing a customer holds is at stake here.
 */

const TOKEN_KEY = 'q.staff.token'

let inMemoryToken: string | null = null
const listeners = new Set<(token: string | null) => void>()

export function getToken(): string | null {
  if (inMemoryToken !== null) return inMemoryToken
  if (typeof window === 'undefined') return null
  try {
    inMemoryToken = window.localStorage.getItem(TOKEN_KEY)
  } catch {
    // Private mode or blocked storage: the session simply does not survive a reload.
    inMemoryToken = null
  }
  return inMemoryToken
}

export function setToken(token: string | null): void {
  inMemoryToken = token
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY)
    else window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Ignore: the in-memory copy still carries this tab's session.
  }
  listeners.forEach((listener) => listener(token))
}

export function subscribeToToken(listener: (token: string | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
