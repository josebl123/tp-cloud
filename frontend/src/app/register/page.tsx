'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { AuthShell } from '@/components/AuthShell'
import { ConfirmCodeForm } from '@/components/ConfirmCodeForm'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

export default function RegisterPage() {
  const router = useRouter()
  const { register } = useAuth()
  const { t } = useI18n()
  const [form, setForm] = useState({
    establishmentName: '',
    displayName: '',
    email: '',
    password: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // After the account is created, Cognito emails a code: the page moves on to ask for it.
  const [awaitingCode, setAwaitingCode] = useState(false)

  const update = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register({
        establishmentName: form.establishmentName.trim(),
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        password: form.password,
      })
      setSubmitting(false)
      setAwaitingCode(true)
    } catch (cause) {
      setError(errorMessage(t, cause))
      setSubmitting(false)
    }
  }

  if (awaitingCode) {
    return (
      <AuthShell>
        <ConfirmCodeForm
          email={form.email.trim()}
          password={form.password}
          onConfirmed={() => router.replace('/panel')}
        />
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1 className="font-display text-4xl tracking-[-0.04em]">{t('auth.registerTitle')}</h1>
      <p className="mt-2 text-muted">{t('auth.registerSubtitle')}</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field
          label={t('auth.businessName')}
          value={form.establishmentName}
          onChange={update('establishmentName')}
          placeholder={t('auth.businessPlaceholder')}
          maxLength={120}
          required
        />
        <Field
          label={t('auth.yourName')}
          value={form.displayName}
          onChange={update('displayName')}
          autoComplete="name"
          maxLength={120}
          required
        />
        <Field
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={update('email')}
          required
        />
        <Field
          label={t('auth.password')}
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={update('password')}
          hint={t('auth.passwordHint')}
          minLength={8}
          pattern="(?=.*[a-z])(?=.*[0-9]).{8,}"
          required
        />
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Button type="submit" size="lg" block loading={submitting}>
          {t('auth.createAccount')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {t('auth.haveAccount')}{' '}
        <Link href="/login" className="font-medium text-brand hover:underline">
          {t('common.signIn')}
        </Link>
      </p>
    </AuthShell>
  )
}
