'use client'

/**
 * Where the staff bearer token lives.
 *
 * Kept in `localStorage` because the app is a static SPA with no server of its own to hold a session
 * cookie. The ID token lasts an hour and is scoped to staff actions; customers never have one, so
 * nothing a customer holds is at stake here. `freshToken` asks the provider (Cognito) for a valid
 * one before every request, renewing it with the refresh token when it expired.
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

let provider: (() => Promise<string | null>) | null = null

/** Who can hand out a valid token: Cognito, which renews it when it expired. */
export function setTokenProvider(next: () => Promise<string | null>): void {
  provider = next
}

/**
 * The token to send with a request, renewed if it expired. When the session can no longer be renewed
 * (the refresh token expired too), the session ends here, like a sign-out.
 */
export async function freshToken(): Promise<string | null> {
  const current = getToken()
  if (current === null || provider === null) return current
  const token = await provider()
  if (token === null) {
    setToken(null)
    return null
  }
  if (token !== current) {
    // A renewal is not a new session: the copy is updated without notifying anyone.
    inMemoryToken = token
    try {
      window.localStorage.setItem(TOKEN_KEY, token)
    } catch {
      // Ignore: the in-memory copy still carries this tab's session.
    }
  }
  return token
}

export function subscribeToToken(listener: (token: string | null) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Signing out was tab-local: the other staff tab kept its in-memory copy, stayed signed in, and went
 * on streaming customer names and email addresses long after the operator thought they had left the
 * shared terminal. `storage` fires in every *other* tab of the origin, so one sign-out now reaches
 * all of them - and a sign-in does too, which is what makes "log in here, come back to that tab"
 * behave the way people expect.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== TOKEN_KEY && event.key !== null) return
    let next: string | null = null
    try {
      next = window.localStorage.getItem(TOKEN_KEY)
    } catch {
      next = null
    }
    if (next === inMemoryToken) return
    inMemoryToken = next
    listeners.forEach((listener) => listener(next))
  })
}
