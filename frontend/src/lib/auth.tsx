'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api } from './api'
import { getToken, setToken } from './session'
import type { EstablishmentView, UserView } from './types'

const ACTIVE_ESTABLISHMENT_KEY = 'q.staff.establishment'

interface AuthState {
  user: UserView | null
  establishments: EstablishmentView[]
  activeEstablishment: EstablishmentView | null
  /** True until the stored token has been checked, so guards do not bounce a signed-in user. */
  initialising: boolean
  isOwner: boolean
  login: (email: string, password: string) => Promise<void>
  register: (input: {
    email: string
    password: string
    displayName: string
    establishmentName: string
  }) => Promise<void>
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
      if (!getToken()) {
        setInitialising(false)
        return
      }
      try {
        const me = await api.auth.me()
        if (cancelled) return
        setUser(me)
        await loadEstablishments()
      } catch (cause) {
        // An expired or revoked token should log you out quietly, not strand you on a broken screen.
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
          setToken(null)
        }
      } finally {
        if (!cancelled) setInitialising(false)
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [loadEstablishments])

  const applySession = useCallback(
    async (result: Awaited<ReturnType<typeof api.auth.login>>) => {
      setToken(result.accessToken)
      setUser(result.user)
      if (result.establishment) {
        setActiveId(result.establishment.id)
        try {
          window.localStorage.setItem(ACTIVE_ESTABLISHMENT_KEY, result.establishment.id)
        } catch {
          /* storage unavailable; the in-memory selection still works for this tab */
        }
      }
      await loadEstablishments()
    },
    [loadEstablishments],
  )

  const login = useCallback(
    async (email: string, password: string) => {
      await applySession(await api.auth.login({ email, password }))
    },
    [applySession],
  )

  const register = useCallback(
    async (input: { email: string; password: string; displayName: string; establishmentName: string }) => {
      await applySession(await api.auth.register(input))
    },
    [applySession],
  )

  const logout = useCallback(() => {
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
      isOwner: activeEstablishment?.role === 'OWNER',
      login,
      register,
      logout,
      selectEstablishment,
      reloadEstablishments: loadEstablishments,
    }),
    [
      user,
      establishments,
      activeEstablishment,
      initialising,
      login,
      register,
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
