'use client'

import { useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/format'

export interface ActionMenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
}

/** A compact, keyboard-friendly home for secondary actions in dense staff views. */
export function ActionMenu({ label, items, className }: { label: string; items: ActionMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={root} className={cx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-9 items-center justify-center rounded-xl border border-line-strong bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:bg-raised"
      >
        {label}
        <span className="ml-1.5 text-faint" aria-hidden>▾</span>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-20 mt-2 min-w-40 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lift">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className="flex w-full rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-raised disabled:pointer-events-none disabled:opacity-45"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
