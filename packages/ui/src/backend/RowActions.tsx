"use client"
import * as React from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type RowActionItem = {
  label: string
  onSelect?: () => void
  href?: string
  destructive?: boolean
}

export function RowActions({ items }: { items: RowActionItem[] }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null)
  const [direction, setDirection] = React.useState<'down' | 'up'>('down')

  const updatePosition = React.useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setAnchorRect(rect)
    // Decide whether to open up or down based on available viewport space
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    setDirection(spaceBelow < 180 && spaceAbove > spaceBelow ? 'up' : 'down')
  }, [])

  React.useEffect(() => {
    if (!open) return
    updatePosition()
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
    function onScrollOrResize() {
      updatePosition()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, updatePosition])

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }
    setOpen(true)
  }

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setOpen(false)
    }, 150) // Small delay to prevent flickering when moving to menu
  }

  return (
    <div
      className="relative inline-block text-left"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={btnRef}
        type="button"
        className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-accent"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((v) => !v); requestAnimationFrame(updatePosition) }}
      >
        <span aria-hidden="true">⋯</span>
        <span className="sr-only">{t('ui.rowActions.openActions', 'Open actions')}</span>
      </button>
      {open && anchorRect && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed w-44 rounded-md border bg-background p-1 shadow focus:outline-none z-[1000]"
          style={{
            top: direction === 'down' ? anchorRect.bottom + 8 : anchorRect.top - 8,
            left: anchorRect.right,
            transform: `translate(-100%, ${direction === 'down' ? '0' : '-100%'})`,
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {items.map((it, idx) => (
            it.href ? (
              <a
                key={idx}
                href={it.href}
                className={`block w-full text-left px-2 py-1 text-sm rounded hover:bg-accent ${it.destructive ? 'text-red-600' : ''}`}
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen(false)
                }}
              >
                {it.label}
              </a>
            ) : (
              <button
                key={idx}
                type="button"
                className={`block w-full text-left px-2 py-1 text-sm rounded hover:bg-accent ${it.destructive ? 'text-red-600' : ''}`}
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen(false)
                  it.onSelect?.()
                }}
              >
                {it.label}
              </button>
            )
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
