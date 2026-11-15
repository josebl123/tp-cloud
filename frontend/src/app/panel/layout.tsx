'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Button } from '@/components/ui/Button'
import { Logo, LogoMark } from '@/components/Logo'
import { PageLoader } from '@/components/PageLoader'
import { cx } from '@/lib/format'

/**
 * Chrome and guard for everything staff-facing.
 *
 * The guard waits for `initialising` rather than checking `user` immediately, so a signed-in
 * operator reloading the board is never bounced back to the sign-in screen.
 */
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, initialising, establishments, activeEstablishment, selectEstablishment, logout } = useAuth()
  const { t } = useI18n()

  useEffect(() => {
    if (!initialising && !user) router.replace('/login')
  }, [initialising, user, router])

  if (initialising) return <PageLoader label={t('panel.signingIn')} />
  if (!user) return <PageLoader label={t('panel.redirecting')} />

  const navigation = [
    { href: '/panel', label: t('panel.overview'), analytics: false, active: !pathname.startsWith('/panel/analytics') },
    { href: '/panel/analytics', label: t('analytics.title'), analytics: true, active: pathname.startsWith('/panel/analytics') },
  ]

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[216px_minmax(0,1fr)] print:block">
      <aside className="no-print sticky top-0 hidden h-dvh flex-col border-r border-line bg-raised/50 px-4 py-7 lg:flex">
        <Link href="/panel" className="mx-2 w-fit"><Logo /></Link>
        <p className="mt-12 mb-3 px-3 text-[0.65rem] font-medium tracking-[0.1em] text-faint uppercase">{t('panel.workspace')}</p>
        <nav aria-label={t('panel.navigation')} className="space-y-1">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                item.active ? 'bg-surface font-medium text-ink shadow-soft' : 'text-muted hover:bg-surface/60 hover:text-ink',
              )}
            >
              <PanelIcon analytics={item.analytics} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-line pt-5">
          <div className="flex min-w-0 items-center gap-3 px-2">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-brand">{user.displayName.slice(0, 1).toUpperCase()}</span>
            <span className="truncate text-sm">{user.displayName}</span>
          </div>
          <Button variant="ghost" size="sm" className="mt-3 w-full justify-start" onClick={logout}>{t('common.signOut')}</Button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-5">
            <Link href="/panel" aria-label="Q" className="shrink-0 lg:hidden">
              <LogoMark />
            </Link>

            {establishments.length > 1 ? (
              <select
                value={activeEstablishment?.id ?? ''}
                onChange={(event) => {
                  selectEstablishment(event.target.value)
                  // Every page below this header is scoped to a queue id belonging to the business
                  // that was selected a moment ago. Without this the header changed and the board
                  // did not, leaving the operator looking at another business's line.
                  router.replace('/panel')
                }}
                aria-label={t('panel.establishment')}
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
              <LanguageSwitcher />
              <span className="hidden text-sm text-muted sm:inline lg:hidden">{user.displayName}</span>
              <Button variant="ghost" size="sm" className="lg:hidden" onClick={logout}>
                {t('common.signOut')}
              </Button>
            </div>
          </div>
          <nav aria-label={t('panel.navigation')} className="flex gap-1 border-t border-line px-5 py-2 lg:hidden">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined} className={cx('flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors', item.active ? 'bg-raised text-ink' : 'text-muted hover:bg-raised')}>
                <PanelIcon analytics={item.analytics} />
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="mx-auto max-w-7xl px-5 py-8 lg:px-9 lg:py-10 print:max-w-none print:px-0 print:py-0">{children}</main>
      </div>
    </div>
  )
}

function PanelIcon({ analytics }: { analytics: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="size-4 shrink-0">
      {analytics ? <path d="M4 15V10M10 15V5M16 15V8" /> : <path d="M7 5H16M7 10H16M7 15H13M3.5 5H3.51M3.5 10H3.51M3.5 15H3.51" />}
    </svg>
  )
}
