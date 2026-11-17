'use client'

import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { cx } from '@/lib/format'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-bg hover:bg-ink/85 shadow-soft',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-raised',
  ghost: 'text-muted hover:text-ink hover:bg-raised',
  danger: 'bg-danger-soft text-danger border border-danger/25 hover:bg-danger hover:text-white',
}

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-[0.95rem] gap-2',
  lg: 'h-14 px-6 text-base gap-2.5',
}

interface Look {
  variant?: Variant
  size?: Size
  block?: boolean
}

/**
 * The one place the button look is defined, so a control that navigates can wear it without being
 * a `<button>`.
 *
 * <p>This exists because the obvious spelling - a `<Link>` wrapped around a `<Button>` - produces
 * `<a><button></a>`, which the HTML content model forbids: an anchor may not contain interactive
 * content. Browsers recover from it differently, keyboard users get two tab stops for one control,
 * and a screen reader announces "link, button". `ButtonLink` renders a single `<a>` that merely
 * looks like a button.
 */
export function buttonClass({ variant = 'primary', size = 'md', block = false }: Look = {}): string {
  return cx(
    'inline-flex items-center justify-center rounded-xl font-medium',
    'transition-[background-color,color,transform,box-shadow] duration-200 ease-out',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
    'aria-disabled:opacity-45 aria-busy:cursor-progress',
    VARIANTS[variant],
    SIZES[size],
    block && 'w-full',
  )
}

// ComponentProps rather than ButtonHTMLAttributes so React 19's `ref`-as-a-prop is typed.
interface Props extends ComponentProps<'button'>, Look {
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  variant,
  size,
  loading = false,
  block,
  icon,
  className,
  children,
  disabled,
  onClick,
  ...rest
}: Props) {
  /*
   * A button that is *unavailable* is `disabled`. A button that is *busy* is not: setting the
   * native attribute mid-action blurs the element the operator is standing on, dropping focus to
   * `<body>` and throwing them back to the top of the document - and it makes the `aria-busy`
   * beside it unreachable, since disabled controls are skipped. So a busy button keeps focus,
   * announces itself busy, and simply swallows its own activation.
   */
  return (
    <button
      {...rest}
      disabled={disabled && !loading}
      aria-disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      onClick={(event) => {
        if (loading) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        onClick?.(event)
      }}
      className={cx(buttonClass({ variant, size, block }), className)}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}

type LinkProps = ComponentProps<typeof Link> & Look & { icon?: ReactNode }

/** A navigation that looks like a button. Renders one `<a>`, never a button inside a link. */
export function ButtonLink({ variant, size, block, icon, className, children, ...rest }: LinkProps) {
  return (
    <Link {...rest} className={cx(buttonClass({ variant, size, block }), className)}>
      {icon}
      {children}
    </Link>
  )
}

/** The same, for a destination Next's router should not own: an external tab, a full reload. */
export function ButtonAnchor({
  variant,
  size,
  block,
  icon,
  className,
  children,
  ...rest
}: ComponentProps<'a'> & Look & { icon?: ReactNode }) {
  return (
    <a {...rest} className={cx(buttonClass({ variant, size, block }), className)}>
      {icon}
      {children}
    </a>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  )
}
