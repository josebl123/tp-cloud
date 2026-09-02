'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Logo } from '@/components/Logo'

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

      <h1 className="font-display text-3xl font-semibold tracking-tight">{t('auth.registerTitle')}</h1>
      <p className="mt-2 text-muted">{t('auth.registerSubtitle')}</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field
          label={t('auth.businessName')}
          value={form.establishmentName}
          onChange={update('establishmentName')}
          placeholder="Parrilla La Espera"
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
    </main>
  )
}
