'use client'

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useId } from 'react'
import { cx } from '@/lib/format'

const CONTROL =
  'w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-ink ' +
  'placeholder:text-faint transition-colors focus:border-brand focus:outline-none ' +
  'disabled:opacity-50'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
  error?: string
  optional?: boolean
}

export function Field({ label, hint, error, optional, className, id, ...rest }: FieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId

  return (
    <div className={className}>
      <label htmlFor={fieldId} className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {optional ? <span className="text-xs text-faint">Optional</span> : null}
      </label>
      <input
        {...rest}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={cx(CONTROL, error && 'border-danger focus:border-danger')}
      />
      {error ? (
        <p id={`${fieldId}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  hint?: ReactNode
}

export function SelectField({ label, hint, className, id, children, ...rest }: SelectFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId

  return (
    <div className={className}>
      <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <select {...rest} id={fieldId} className={cx(CONTROL, 'appearance-none pr-9')}>
        {children}
      </select>
      {hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}
