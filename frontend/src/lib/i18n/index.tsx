'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, type MessageKey } from './messages'
import { es } from './messages.es'

export type Locale = 'en' | 'es'
export type Vars = Record<string, string | number>

/** Translates a key, substituting `{placeholders}` from `vars`. */
export type Translate = (key: MessageKey, vars?: Vars) => string

/** Translates a countable key, choosing between its `_one` and `_other` variants. */
export type TranslatePlural = (base: string, count: number, vars?: Vars) => string

interface I18nState {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translate
  tp: TranslatePlural
  /** False until the browser's language has been read, so nothing renders a guess as final. */
  resolved: boolean
}

const BUNDLES: Record<Locale, Record<string, string>> = { en, es }
const STORAGE_KEY = 'q.locale'

const I18nContext = createContext<I18nState | null>(null)

/**
 * Resolves the language from, in order: an explicit choice the user made before, the browser's own
 * preference, then English.
 */
function detectLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'es') return stored
  } catch {
    // Storage blocked; fall through to the browser preference.
  }
  const preferred = window.navigator.languages?.[0] ?? window.navigator.language ?? ''
  return preferred.toLowerCase().startsWith('es') ? 'es' : 'en'
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

/**
 * Supplies the active language to the whole tree.
 *
 * <p>Detection runs in an effect rather than during the first render on purpose: the pages are
 * prerendered at build time in English, so resolving the language before hydration would make the
 * client's first render disagree with the served HTML. The cost is one frame of English before a
 * Spanish browser settles, which is the standard trade for a static export.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en')
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    setLocaleState(detectLocale())
    setResolved(true)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage blocked; the choice still applies for this tab.
    }
  }, [])

  const value = useMemo<I18nState>(() => {
    const bundle = BUNDLES[locale]

    const t: Translate = (key, vars) => interpolate(bundle[key] ?? en[key] ?? key, vars)

    const tp: TranslatePlural = (base, count, vars) => {
      const key = `${base}_${count === 1 ? 'one' : 'other'}` as MessageKey
      return interpolate(bundle[key] ?? en[key] ?? key, { count, ...vars })
    }

    return { locale, setLocale, t, tp, resolved }
  }, [locale, setLocale, resolved])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nState {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>')
  return context
}

/** Shorthand for the common case of needing only the translate function. */
export function useT(): Translate {
  return useI18n().t
}

export type { MessageKey }
