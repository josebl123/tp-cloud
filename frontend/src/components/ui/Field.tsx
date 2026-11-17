'use client'

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useId } from 'react'
import { cx } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

/*
 * `focus:outline-none` used to be here. Tailwind's utilities sit in a later cascade layer than
 * `@layer base`, so it beat the global `:focus-visible` rule outright and every input, number box,
 * password field and select in the app was left with only a 1px border tint as its focus cue. The
 * border change stays for the pointer; the ring comes back for the keyboard.
 */
const CONTROL =
  'w-full rounded-xl border border-line-strong bg-bg/50 px-3.5 py-3 text-ink ' +
  'placeholder:text-faint transition-[border-color,background-color,box-shadow] duration-200 focus:border-brand focus:bg-surface focus:shadow-soft ' +
  'disabled:opacity-50'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
  error?: string
  optional?: boolean
}

export function Field({ label, hint, error, optional, className, id, ...rest }: FieldProps) {
  const { t } = useI18n()
  const generatedId = useId()
  const fieldId = id ?? generatedId

  return (
    <div className={className}>
      <label htmlFor={fieldId} className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {optional ? <span className="text-xs text-faint">{t('common.optional')}</span> : null}
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
      <div className="relative">
        <select
          {...rest}
          id={fieldId}
          // The hint explains what the selected option does, so it has to be part of the control's
          // description the way Field already does it - not a loose paragraph underneath.
          aria-describedby={hint ? `${fieldId}-hint` : undefined}
          className={cx(CONTROL, 'appearance-none pr-9')}
        >
          {children}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-faint"
        >
          ▾
        </span>
      </div>
      {hint ? (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
