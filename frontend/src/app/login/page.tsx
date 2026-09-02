'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Logo } from '@/components/Logo'

export default function LoginPage() {
  const router = useRouter()
  const { login, user, initialising } = useAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!initialising && user) router.replace('/panel')
  }, [initialising, user, router])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email.trim(), password)
      router.replace('/panel')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-12">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/">
          <Logo />
        </Link>
        <LanguageSwitcher />
      </div>

      <h1 className="font-display text-3xl font-semibold tracking-tight">{t('common.signIn')}</h1>
      <p className="mt-2 text-muted">{t('auth.signInSubtitle')}</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <Field
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Button type="submit" size="lg" block loading={submitting}>
          {t('common.signIn')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {t('auth.noAccount')}{' '}
        <Link href="/register" className="font-medium text-brand hover:underline">
          {t('auth.createOne')}
        </Link>
      </p>
    </main>
  )
}
