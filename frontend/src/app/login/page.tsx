'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { errorMessage } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { AuthShell } from '@/components/AuthShell'
import { ConfirmCodeForm } from '@/components/ConfirmCodeForm'
import { ApiError } from '@/lib/api'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

export default function LoginPage() {
  const router = useRouter()
  const { login, user, initialising } = useAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // An account that signed up but never entered the code cannot sign in until it does.
  const [awaitingCode, setAwaitingCode] = useState(false)

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
      setSubmitting(false)
      if (cause instanceof ApiError && cause.code === 'ACCOUNT_NOT_CONFIRMED') {
        setAwaitingCode(true)
        return
      }
      setError(errorMessage(t, cause))
    }
  }

  if (awaitingCode) {
    return (
      <AuthShell>
        <ConfirmCodeForm
          email={email.trim()}
          password={password}
          intro={t('auth.notConfirmed')}
          onConfirmed={() => router.replace('/panel')}
        />
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1 className="font-display text-4xl tracking-[-0.04em]">{t('common.signIn')}</h1>
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
    </AuthShell>
  )
}
