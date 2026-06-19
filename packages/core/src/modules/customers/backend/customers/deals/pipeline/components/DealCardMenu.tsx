"use client"

import * as React from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { RowActionItem } from '@open-mercato/ui/backend/RowActions'

type DealCardMenuProps = {
  items: RowActionItem[]
  ariaLabel: string
}

const MENU_GAP = 6

// Right-aligned shortcut hint inside a menu row. Mirrors the Figma deal-card menu
// (node 1045:12254), which shows ⏎ for Open, E for Edit, ⌘D for Duplicate.
// `aria-hidden="true"` keeps the kbd out of the menu item's accessible name —
// without this the menu item reads as "Open deal ↵" instead of "Open deal" and
// `getByRole('menuitem', { name: 'Open deal', exact: true })` fails in tests.
function MenuShortcut({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <kbd
      aria-hidden="true"
      className="ml-auto inline-flex items-center rounded border border-border bg-muted px-1.5 py-px font-mono text-[10px] font-medium leading-none text-muted-foreground"
    >
      {children}
    </kbd>
  )
}

// Map of menu-item id → keyboard shortcut hint. Stay in sync with `buildMenuItems` in
// `pipeline/page.tsx` and with `matchesShortcut` below.
const ITEM_SHORTCUTS: Record<string, React.ReactNode> = {
  open: '↵',
  edit: 'E',
  duplicate: '⌘D',
}

function matchesShortcut(itemId: string, event: KeyboardEvent): boolean {
  if (itemId === 'open' && event.key === 'Enter') return true
  if (itemId === 'edit' && (event.key === 'e' || event.key === 'E') && !event.metaKey && !event.ctrlKey) return true
  if (itemId === 'duplicate' && (event.key === 'd' || event.key === 'D') && (event.metaKey || event.ctrlKey)) return true
  return false
}

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
    // Autofocus the first menu item once the portal has painted. We schedule this on the
    // next frame so the `createPortal` render has actually mounted the buttons in the DOM.
    requestAnimationFrame(() => {
      const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
      first?.focus()
    })
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
        return
      }
      // Hotkey wiring: when the menu is open and focus is inside it, ⏎/E/⌘D trigger
      // the matching action. Skip when an editable surface owns focus.
      const active = document.activeElement as HTMLElement | null
      if (active) {
        const tag = active.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return
      }
      if (!menuRef.current?.contains(active)) return
      for (const item of items) {
        if (item.id && matchesShortcut(item.id, e)) {
          e.preventDefault()
          setOpen(false)
          item.onSelect?.()
          return
        }
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

  // Arrow-key navigation between menu items. Scoped to the menu so it doesn't fight with
  // global shortcuts when something else is focused.
  const handleMenuKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    if (items.length === 0) return
    const currentIdx = items.findIndex((el) => el === document.activeElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = items[(currentIdx + 1 + items.length) % items.length]
      next?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prev = items[(currentIdx - 1 + items.length) % items.length]
      prev?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
    }
  }, [])

  if (!items.length) return null

  return (
    <div className="relative inline-flex" data-card-action="true" onClick={(event) => event.stopPropagation()}>
      <IconButton
        ref={btnRef}
        variant="ghost"
        size="xs"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((previous) => !previous)
          requestAnimationFrame(updatePosition)
        }}
        className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreVertical className="size-3.5" aria-hidden="true" />
      </IconButton>
      {open && anchor && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              onKeyDown={handleMenuKeyDown}
              className="fixed z-dropdown w-52 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-background p-1.5 shadow-md"
              style={{
                top:
                  direction === 'down'
                    ? anchor.bottom + MENU_GAP
                    : anchor.top - MENU_GAP,
                left: Math.min(anchor.right, window.innerWidth - 8),
                transform: `translate(-100%, ${direction === 'down' ? '0' : '-100%'})`,
              }}
            >
              {items.map((item, idx) => {
                const shortcut = item.id ? ITEM_SHORTCUTS[item.id] : null
                return (
                  <Button
                    variant={item.destructive ? 'destructive-ghost' : 'ghost'}
                    size="sm"
                    key={item.id ?? `${item.label}-${idx}`}
                    type="button"
                    role="menuitem"
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpen(false)
                      item.onSelect?.()
                    }}
                    className={`flex w-full items-center justify-start rounded-sm px-3 py-2 text-left text-sm leading-5 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${
                      item.destructive ? 'text-status-error-text hover:bg-status-error-bg/30' : 'text-foreground'
                    }`}
                  >
                    <span className="flex-1 truncate">{item.label}</span>
                    {shortcut ? <MenuShortcut>{shortcut}</MenuShortcut> : null}
                  </Button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export default DealCardMenu
