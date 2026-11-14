'use client'

import { useState, type FormEvent } from 'react'
import { errorMessage } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

/**
 * The step after signing up: Cognito emailed a code, and the account cannot sign in until it is
 * confirmed. Used by the sign-up page and by the sign-in page, for an account that never finished.
 */
export function ConfirmCodeForm({
  email,
  password,
  intro,
  onConfirmed,
}: {
  email: string
  password: string
  intro?: string
  onConfirmed: () => void
}) {
  const { confirmAccount, resendCode } = useAuth()
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      await confirmAccount(email, code.trim(), password)
      onConfirmed()
    } catch (cause) {
      setError(errorMessage(t, cause))
      setSubmitting(false)
    }
  }

  const resend = async () => {
    setError(null)
    setNotice(null)
    setResending(true)
    try {
      await resendCode(email)
      setNotice(t('auth.codeResent'))
    } catch (cause) {
      setError(errorMessage(t, cause))
    } finally {
      setResending(false)
    }
  }

  return (
    <>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{t('auth.codeTitle')}</h1>
      <p className="mt-2 text-muted">{intro ?? t('auth.codeSubtitle', { email })}</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field
          label={t('auth.code')}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={10}
          required
          autoFocus
        />
        {error ? <Alert kind="error">{error}</Alert> : null}
        {notice ? <Alert kind="success">{notice}</Alert> : null}
        <Button type="submit" size="lg" block loading={submitting}>
          {t('auth.confirmAccount')}
        </Button>
        <Button type="button" variant="ghost" block loading={resending} onClick={resend}>
          {t('auth.resendCode')}
        </Button>
      </form>
    </>
  )
}
