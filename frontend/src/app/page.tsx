'use client'

import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Logo } from '@/components/Logo'
import { QueueIllustration } from '@/components/QueueIllustration'
import { ButtonLink } from '@/components/ui/Button'

export default function HomePage() {
  const { t } = useI18n()

  const features = [
    { term: t('landing.customerTerm'), detail: t('landing.customerDetail') },
    { term: t('landing.staffTerm'), detail: t('landing.staffDetail') },
    { term: t('landing.noShowTerm'), detail: t('landing.noShowDetail') },
  ]

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-6 sm:px-10">
      <header className="flex items-center justify-between gap-3 py-6 sm:py-8">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ButtonLink href="/login" variant="ghost" size="sm">
            {t('common.signIn')}
          </ButtonLink>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="grid items-center gap-10 py-12 sm:py-20 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:py-24">
          <div className="stagger-in">
            <p className="flex items-center gap-2.5 text-xs font-medium tracking-[0.12em] text-muted uppercase">
              <span aria-hidden="true" className="h-px w-7 bg-clay" />
              {t('landing.eyebrow')}
            </p>
            <h1 className="mt-6 font-display text-[clamp(3rem,5.8vw,4.75rem)] leading-[1.06] tracking-[-0.055em] text-balance">
              {t('landing.headlineTop')}
              <br />
              <span className="text-brand italic">{t('landing.headlineBottom')}</span>
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted sm:text-lg">{t('landing.lede')}</p>
            <div className="mt-8 flex flex-col items-start gap-4">
              <ButtonLink href="/register" size="lg" className="group">
                {t('landing.ctaPrimary')}
                <span aria-hidden="true" className="ml-2 transition-transform duration-200 group-hover:translate-x-1">↗</span>
              </ButtonLink>
              <p className="text-xs text-faint">{t('landing.reassurance')}</p>
            </div>
          </div>

          <figure className="relative mx-auto w-full max-w-md">
            <QueueIllustration className="relative z-10 mx-auto -mb-3 w-full" />
            <div className="animate-in rounded-2xl border border-line bg-surface px-7 py-6 shadow-lift sm:px-9 sm:py-8">
              <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
                <p className="font-display text-lg tracking-tight">{t('landing.previewTitle')}</p>
                <span className="rounded-md bg-raised px-2 py-1 text-[0.65rem] font-medium text-muted">{t('landing.previewTag')}</span>
              </div>
              <div className="grid grid-cols-2 items-end gap-4 pt-6 pb-5">
                <div>
                  <p className="display-number text-7xl text-brand">3</p>
                  <p className="mt-3 text-xs text-muted">{t('ticket.groupsScheduledBefore')}</p>
                </div>
                <div className="border-l border-line pl-6">
                  <p className="font-display text-4xl tracking-tight">12 <span className="text-xl">min</span></p>
                  <p className="mt-2 text-xs text-muted">{t('ticket.estimatedWait')}</p>
                </div>
              </div>
              <div aria-hidden="true" className="flex items-center gap-2">
                {[0, 1, 2].map((position) => <span key={position} className="h-1.5 flex-1 rounded-full bg-raised" />)}
                <span className="h-1.5 flex-1 rounded-full bg-clay" />
              </div>
            </div>
            <figcaption className="mt-5 text-center text-xs text-faint">{t('landing.previewCaption')}</figcaption>
          </figure>
        </section>

        <dl className="stagger-in grid gap-7 border-t border-line py-10 sm:grid-cols-3 sm:gap-10 sm:py-12">
          {features.map((item, index) => (
            <div key={item.term} className="flex gap-4">
              <span aria-hidden="true" className="pt-1 font-display text-sm text-brand italic">0{index + 1}</span>
              <div>
                <dt className="font-display text-xl tracking-tight">{item.term}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{item.detail}</dd>
              </div>
            </div>
          ))}
        </dl>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-xs text-faint">
        <span>{t('landing.footer')}</span>
        <span className="font-display text-sm italic">{t('landing.signoff')}</span>
      </footer>
    </div>
  )
}
