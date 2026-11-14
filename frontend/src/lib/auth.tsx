'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api } from './api'
import { confirmSignUp, currentIdToken, resendCode, signIn, signOut, signUp } from './cognito'
import { setToken, setTokenProvider, subscribeToToken } from './session'
import type { EstablishmentView, UserView } from './types'

const ACTIVE_ESTABLISHMENT_KEY = 'q.staff.establishment'
/**
 * The business someone registered and still has to create. The account exists as soon as Cognito
 * accepts the sign-up, but the business can only be created once the email is confirmed and there
 * is a session: it waits here, in case the confirmation happens later from the sign-in page.
 */
const PENDING_BUSINESS_KEY = 'q.staff.pendingBusiness'

// Every request asks Cognito for a valid token, renewed with the refresh token when it expired.
setTokenProvider(currentIdToken)

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

interface AuthState {
  user: UserView | null
  establishments: EstablishmentView[]
  activeEstablishment: EstablishmentView | null
  /** True until the stored token has been checked, so guards do not bounce a signed-in user. */
  initialising: boolean
  /** Set when the session was restored but its establishments could not be loaded. */
  restoreError: ApiError | null
  /** Retries the establishment load after a `restoreError`. */
  retryRestore: () => void
  isOwner: boolean
  login: (email: string, password: string) => Promise<void>
  /** Creates the account; Cognito emails a code that `confirmAccount` checks. */
  register: (input: {
    email: string
    password: string
    displayName: string
    establishmentName: string
  }) => Promise<void>
  /** Confirms the email with the code, signs in, and creates the business registered with it. */
  confirmAccount: (email: string, code: string, password: string) => Promise<void>
  resendCode: (email: string) => Promise<void>
  logout: () => void
  selectEstablishment: (id: string) => void
  reloadEstablishments: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserView | null>(null)
  const [establishments, setEstablishments] = useState<EstablishmentView[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [initialising, setInitialising] = useState(true)
  const [restoreError, setRestoreError] = useState<ApiError | null>(null)
  const [restoreAttempt, setRestoreAttempt] = useState(0)

  const readStoredActive = () => {
    try {
      return window.localStorage.getItem(ACTIVE_ESTABLISHMENT_KEY)
    } catch {
      return null
    }
  }

  const loadEstablishments = useCallback(async () => {
    const list = await api.establishments.list()
    setEstablishments(list)
    setActiveId((current) => {
      const stored = current ?? readStoredActive()
      const match = list.find((item) => item.id === stored)
      return match?.id ?? list[0]?.id ?? null
    })
  }, [])

  // Restore the session from the stored token, once.
  useEffect(() => {
    let cancelled = false

    const restore = async () => {
      // Cognito keeps the session: if its refresh token is still valid, this renews the ID token.
      const token = await currentIdToken()
      if (!token) {
        setToken(null)
        setInitialising(false)
        return
      }
      setToken(token)
      try {
        const me = await api.auth.me()
        if (cancelled) return
        setUser(me)
        await loadEstablishments()
        if (!cancelled) setRestoreError(null)
      } catch (cause) {
        // An expired or revoked token should log you out quietly, not strand you on a broken screen.
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
          setToken(null)
          setUser(null)
        } else {
          // Anything else - the API down, a 500, no network - used to be swallowed here while
          // `user` stayed set, and the panel then waited forever for an establishment that was
          // never going to arrive. Record it so the panel can say so and offer a retry.
          setRestoreError(cause instanceof ApiError ? cause : new ApiError(0, 'NETWORK_ERROR', 'restore failed'))
        }
      } finally {
        if (!cancelled) setInitialising(false)
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [loadEstablishments, restoreAttempt])

  // The token can now vanish from under us: a 401 anywhere in the app drops it, and so does signing
  // out in another tab. Either way this session has to end here too.
  useEffect(
    () =>
      subscribeToToken((token) => {
        if (token === null) {
          void signOut()
          setUser(null)
          setEstablishments([])
          setActiveId(null)
        }
      }),
    [],
  )

  /**
   * Starts a session from a Cognito token: who you are comes from the API (`/auth/me`), and so do
   * the establishments you belong to. `establishmentId` preselects one, as after signing up.
   */
  const startSession = useCallback(
    async (token: string, establishmentId?: string) => {
      setToken(token)
      if (establishmentId) {
        setActiveId(establishmentId)
        try {
          window.localStorage.setItem(ACTIVE_ESTABLISHMENT_KEY, establishmentId)
        } catch {
          /* storage unavailable; the in-memory selection still works for this tab */
        }
      }
      setUser(await api.auth.me())
      await loadEstablishments()
    },
    [loadEstablishments],
  )

  const login = useCallback(
    async (email: string, password: string) => {
      await startSession(await signIn(email, password))
    },
    [startSession],
  )

  /**
   * Signing up is two steps: create the account, and confirm the email with the code Cognito sends.
   * The business is created after the confirmation, once there is a session to create it with.
   */
  const register = useCallback(
    async (input: { email: string; password: string; displayName: string; establishmentName: string }) => {
      await signUp({ email: input.email, password: input.password, displayName: input.displayName })
      storage()?.setItem(
        PENDING_BUSINESS_KEY,
        JSON.stringify({ email: input.email.toLowerCase(), name: input.establishmentName }),
      )
    },
    [],
  )

  const confirmAccount = useCallback(
    async (email: string, code: string, password: string) => {
      await confirmSignUp(email, code)
      const token = await signIn(email, password)
      // The token has to be in place before creating the business: that call is authenticated.
      setToken(token)

      let establishmentId: string | undefined
      const pending = (() => {
        try {
          return JSON.parse(storage()?.getItem(PENDING_BUSINESS_KEY) ?? 'null') as { email: string; name: string } | null
        } catch {
          return null
        }
      })()
      if (pending && pending.email === email.toLowerCase()) {
        const establishment = await api.establishments.create({
          name: pending.name,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
        establishmentId = establishment.id
        storage()?.removeItem(PENDING_BUSINESS_KEY)
      }
      await startSession(token, establishmentId)
    },
    [startSession],
  )

  const logout = useCallback(() => {
    void signOut()
    setToken(null)
    setUser(null)
    setEstablishments([])
    setActiveId(null)
    try {
      window.localStorage.removeItem(ACTIVE_ESTABLISHMENT_KEY)
    } catch {
      /* nothing to clean up */
    }
  }, [])

  const selectEstablishment = useCallback((id: string) => {
    setActiveId(id)
    try {
      window.localStorage.setItem(ACTIVE_ESTABLISHMENT_KEY, id)
    } catch {
      /* storage unavailable */
    }
  }, [])

  const activeEstablishment = useMemo(
    () => establishments.find((item) => item.id === activeId) ?? null,
    [establishments, activeId],
  )

  const value = useMemo<AuthState>(
    () => ({
      user,
      establishments,
      activeEstablishment,
      initialising,
      restoreError,
      retryRestore: () => {
        setRestoreError(null)
        setInitialising(true)
        setRestoreAttempt((value) => value + 1)
      },
      isOwner: activeEstablishment?.role === 'OWNER',
      login,
      register,
      confirmAccount,
      resendCode,
      logout,
      selectEstablishment,
      reloadEstablishments: loadEstablishments,
    }),
    [
      user,
      establishments,
      activeEstablishment,
      initialising,
      restoreError,
      login,
      register,
      confirmAccount,
      logout,
      selectEstablishment,
      loadEstablishments,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
