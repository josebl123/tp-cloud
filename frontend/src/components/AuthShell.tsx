'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Logo } from '@/components/Logo'
import { QueueIllustration } from '@/components/QueueIllustration'

export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useI18n()

  return (
    <main className="lg:grid lg:min-h-dvh lg:grid-cols-[1fr_1fr]">
      <aside className="hidden lg:flex lg:flex-col lg:justify-between lg:border-r lg:border-line lg:bg-raised/60 lg:px-12 lg:py-9 xl:px-20">
        <Link href="/" className="w-fit"><Logo /></Link>

        <div className="stagger-in mx-auto w-full max-w-md py-10">
          <p className="text-xs font-medium tracking-[0.12em] text-muted uppercase">{t('landing.eyebrow')}</p>
          <h2 className="mt-5 font-display text-[clamp(2.75rem,4.5vw,4.5rem)] leading-[1.06] tracking-[-0.05em]">
            {t('landing.headlineTop')}
            <br />
            <span className="text-brand italic">{t('landing.headlineBottom')}</span>
          </h2>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted">{t('landing.lede')}</p>
          <QueueIllustration className="mt-8 w-full" />
        </div>

        <div className="flex items-center justify-between gap-4">
          <p className="font-display text-sm text-muted italic">{t('landing.signoff')}</p>
          <LanguageSwitcher />
        </div>
      </aside>

      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10 sm:px-10 lg:min-h-0">
        <div className="mb-10 flex items-center justify-between lg:hidden">
          <Link href="/"><Logo /></Link>
          <LanguageSwitcher />
        </div>
        <div className="animate-in">
          {children}
        </div>
      </div>
    </main>
  )
}
