"use client"

import * as React from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'
import type { RowActionItem } from '@open-mercato/ui/backend/RowActions'

type DealCardMenuProps = {
  items: RowActionItem[]
  ariaLabel: string
}

const MENU_GAP = 6

export function DealCardMenu({ items, ariaLabel }: DealCardMenuProps): React.ReactElement | null {
  const [open, setOpen] = React.useState(false)
  const [anchor, setAnchor] = React.useState<DOMRect | null>(null)
  const [direction, setDirection] = React.useState<'down' | 'up'>('down')
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  const updatePosition = React.useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setAnchor(rect)
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    setDirection(spaceBelow < 220 && spaceAbove > spaceBelow ? 'up' : 'down')
  }, [])

  React.useEffect(() => {
    if (!open) return
    updatePosition()
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        btnRef.current &&
        !btnRef.current.contains(target)
      ) {
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

  if (!items.length) return null

  return (
    <div className="relative inline-flex" data-card-action="true" onClick={(event) => event.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((v) => !v)
          requestAnimationFrame(updatePosition)
        }}
        className="inline-flex size-[16px] items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreVertical className="size-[14px]" aria-hidden="true" />
      </button>
      {open && anchor && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-dropdown w-44 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-background p-1 shadow"
              style={{
                top:
                  direction === 'down'
                    ? anchor.bottom + MENU_GAP
                    : anchor.top - MENU_GAP,
                left: Math.min(anchor.right, window.innerWidth - 8),
                transform: `translate(-100%, ${direction === 'down' ? '0' : '-100%'})`,
              }}
            >
              {items.map((item, idx) => (
                <button
                  key={item.id ?? `${item.label}-${idx}`}
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation()
                    setOpen(false)
                    item.onSelect?.()
                  }}
                  className={`flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[12px] leading-[16px] transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${
                    item.destructive ? 'text-status-error-text hover:bg-status-error-bg/30' : 'text-foreground'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export default DealCardMenu
