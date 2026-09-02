'use client'

import { useI18n, type Locale } from '@/lib/i18n'
import { cx } from '@/lib/format'

const OPTIONS: Array<{ locale: Locale; label: string }> = [
  { locale: 'en', label: 'EN' },
  { locale: 'es', label: 'ES' },
]

/**
 * The language follows the browser by default; this is the override for when it guesses wrong —
 * a tourist on a Spanish phone, or shared staff hardware set to one language.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()

  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className={cx('inline-flex rounded-lg border border-line bg-raised p-0.5', className)}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.locale}
          type="button"
          onClick={() => setLocale(option.locale)}
          aria-pressed={locale === option.locale}
          className={cx(
            'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
            locale === option.locale ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
