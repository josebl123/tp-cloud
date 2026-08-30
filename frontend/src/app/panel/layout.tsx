'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/Logo'
import { PageLoader } from '@/components/PageLoader'

/**
 * Chrome and guard for everything staff-facing.
 *
 * The guard waits for `initialising` rather than checking `user` immediately, so a signed-in
 * operator reloading the board is never bounced back to the sign-in screen.
 */
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, initialising, establishments, activeEstablishment, selectEstablishment, logout } = useAuth()

  useEffect(() => {
    if (!initialising && !user) router.replace('/login')
  }, [initialising, user, router])

  if (initialising) return <PageLoader label="Signing you in" />
  if (!user) return <PageLoader label="Redirecting" />

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
          <Link href="/panel" className="shrink-0">
            <Logo />
          </Link>

          {establishments.length > 1 ? (
            <select
              value={activeEstablishment?.id ?? ''}
              onChange={(event) => selectEstablishment(event.target.value)}
              aria-label="Establishment"
              className="max-w-[42vw] truncate rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm"
            >
              {establishments.map((establishment) => (
                <option key={establishment.id} value={establishment.id}>
                  {establishment.name}
                </option>
              ))}
            </select>
          ) : activeEstablishment ? (
            <span className="truncate text-sm text-muted">{activeEstablishment.name}</span>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-muted sm:inline">{user.displayName}</span>
            <Button variant="ghost" size="sm" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  )
}
