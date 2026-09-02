'use client'

import Link from 'next/link'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'

export default function HomePage() {
  const { t } = useI18n()

  const features = [
    { term: t('landing.customerTerm'), detail: t('landing.customerDetail') },
    { term: t('landing.staffTerm'), detail: t('landing.staffDetail') },
    { term: t('landing.noShowTerm'), detail: t('landing.noShowDetail') },
  ]

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-8">
      <header className="flex items-center justify-between gap-3">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Link href="/login">
            <Button variant="ghost" size="sm">
              {t('common.signIn')}
            </Button>
          </Link>
        </div>
      </header>

      <div className="flex flex-1 flex-col justify-center py-16">
        <p className="text-sm font-medium text-brand">{t('landing.eyebrow')}</p>
        <h1 className="mt-3 font-display text-[clamp(2.5rem,8vw,4rem)] leading-[0.95] font-semibold tracking-tight text-balance">
          {t('landing.headlineTop')}
          <br />
          {t('landing.headlineBottom')}
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">{t('landing.lede')}</p>

        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/register">
            <Button size="lg">{t('landing.ctaPrimary')}</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="secondary">
              {t('landing.ctaSecondary')}
            </Button>
          </Link>
        </div>

        <dl className="mt-16 grid gap-6 sm:grid-cols-3">
          {features.map((item) => (
            <div key={item.term}>
              <dt className="font-display text-base font-semibold">{item.term}</dt>
              <dd className="mt-1.5 text-sm text-muted">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </div>

      <footer className="border-t border-line pt-6 text-xs text-faint">{t('landing.footer')}</footer>
    </main>
  )
}
