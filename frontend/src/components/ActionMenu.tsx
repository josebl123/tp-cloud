'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/format'

export interface ActionMenuItem {
  label: string
  /** Navigation. Renders a real anchor, so middle-click and "open in new tab" keep working. */
  href?: string
  /** An action. Renders a button. Exactly one of `href` or `onSelect` is expected. */
  onSelect?: () => void
  disabled?: boolean
}

/**
 * A compact home for secondary actions in dense staff views.
 *
 * <p>Two things here are deliberate. Navigation items stay anchors rather than becoming buttons that
 * push a route: a menu is a presentation choice and should not cost the operator middle-click, "open
 * in new tab", or the status bar preview of where a row goes.
 *
 * <p>And `role="menu"` is a promise about the keyboard. A container that carries the role but leaves
 * arrow keys unhandled is worse than no role at all, because a screen reader announces a menu and
 * then it does not behave like one - so focus moves here on open, cycles with the arrow keys, and
 * returns to the trigger on close. Focus outlines come from the global `:focus-visible` rule in
 * globals.css; nothing here should override it.
 */
export function ActionMenu({
  label,
  items,
  className,
}: {
  label: string
  items: ActionMenuItem[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) trigger.current?.focus()
  }, [])

  const focusItem = (index: number) => {
    const enabled = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0)
    if (enabled.length === 0) return
    const wrapped = ((index % enabled.length) + enabled.length) % enabled.length
    const target = enabled[wrapped]
    if (target === undefined) return
    itemRefs.current[target]?.focus()
  }

  useEffect(() => {
    if (!open) return
    focusItem(0)

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false)
    }
    // `focusin` bubbles, unlike `focus`, so listening on the document is enough to notice focus
    // leaving the menu by any route - Tab, a click elsewhere, or a programmatic move.
    const onFocusIn = (event: FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close])

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const enabled = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0)
    const current = enabled.indexOf(itemRefs.current.findIndex((el) => el === document.activeElement))

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusItem(current + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        focusItem(current - 1)
        break
      case 'Home':
        event.preventDefault()
        focusItem(0)
        break
      case 'End':
        event.preventDefault()
        focusItem(enabled.length - 1)
        break
      case 'Escape':
        event.preventDefault()
        close(true)
        break
      case 'Tab':
        // Let focus leave naturally, but do not leave an orphaned popup behind it.
        close(false)
        break
    }
  }

  return (
    <div ref={root} className={cx('relative', className)}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cx(
          'inline-flex h-9 items-center justify-center rounded-xl border border-line-strong',
          'bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:bg-raised',
        )}
      >
        {label}
        <span className="ml-1.5 text-faint" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cx(
            'absolute right-0 z-20 mt-2 min-w-44 overflow-hidden rounded-xl',
            'border border-line bg-surface p-1 shadow-lift',
          )}
        >
          {items.map((item, index) => {
            const shared = {
              role: 'menuitem' as const,
              tabIndex: -1,
              className: cx(
                'flex w-full rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors',
                'hover:bg-raised focus:bg-raised',
                item.disabled && 'pointer-events-none opacity-45',
              ),
            }

            return item.href && !item.disabled ? (
              <Link
                key={item.label}
                {...shared}
                href={item.href}
                ref={(el) => {
                  itemRefs.current[index] = el
                }}
                onClick={() => close(false)}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                {...shared}
                type="button"
                disabled={item.disabled}
                ref={(el) => {
                  itemRefs.current[index] = el
                }}
                onClick={() => {
                  close(true)
                  item.onSelect?.()
                }}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
