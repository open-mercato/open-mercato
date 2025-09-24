"use client"
import * as React from 'react'

export type RowActionItem = {
  label: string
  onSelect?: () => void
  href?: string
  destructive?: boolean
}

export function RowActions({ items }: { items: RowActionItem[] }) {
  const [open, setOpen] = React.useState(false)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node
      if (menuRef.current && !menuRef.current.contains(t) && btnRef.current && !btnRef.current.contains(t)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative inline-block text-left">
      <button
        ref={btnRef}
        type="button"
        className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-accent"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>⋯</span>
        <span className="sr-only">Open actions</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 mt-2 w-44 rounded-md border bg-background p-1 shadow focus:outline-none z-20"
        >
          {items.map((it, idx) => (
            it.href ? (
              <a
                key={idx}
                href={it.href}
                className={`block w-full text-left px-2 py-1 text-sm rounded hover:bg-accent ${it.destructive ? 'text-red-600' : ''}`}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                {it.label}
              </a>
            ) : (
              <button
                key={idx}
                type="button"
                className={`block w-full text-left px-2 py-1 text-sm rounded hover:bg-accent ${it.destructive ? 'text-red-600' : ''}`}
                role="menuitem"
                onClick={() => { setOpen(false); it.onSelect?.() }}
              >
                {it.label}
              </button>
            )
          ))}
        </div>
      ) : null}
    </div>
  )
}

