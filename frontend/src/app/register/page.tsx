'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Logo } from '@/components/Logo'

export default function RegisterPage() {
  const router = useRouter()
  const { register } = useAuth()
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
      <Link href="/" className="mb-8 self-start">
        <Logo />
      </Link>

      <h1 className="font-display text-3xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-2 text-muted">
        This sets up your business and makes you its owner. You can add staff afterwards.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field
          label="Business name"
          value={form.establishmentName}
          onChange={update('establishmentName')}
          placeholder="Parrilla La Espera"
          maxLength={120}
          required
        />
        <Field
          label="Your name"
          value={form.displayName}
          onChange={update('displayName')}
          autoComplete="name"
          maxLength={120}
          required
        />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={update('email')}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={update('password')}
          hint="At least 8 characters."
          minLength={8}
          required
        />
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Button type="submit" size="lg" block loading={submitting}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  )
}
