"use client"
import * as React from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '../primitives/icon-button'
import { Button } from '../primitives/button'

export type RowActionItem = {
  id?: string
  label: string
  onSelect?: () => void
  href?: string
  destructive?: boolean
}

export function RowActions({ items = [] }: { items?: RowActionItem[] }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null)
  const [direction, setDirection] = React.useState<'down' | 'up'>('down')

  /** The menu's items in DOM order, as focusable elements. */
  const getFocusableItems = React.useCallback((): HTMLElement[] => {
    if (!menuRef.current) return []
    return Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'))
  }, [])

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
        return
      }
      // Arrow keys move between items instead of doing nothing (#6718). Without
      // this the only way to reach an item was to Tab through it — and since
      // every row's trigger sits in the tab order, reaching the first item of a
      // six-row table took eleven Tab presses.
      const focusables = getFocusableItems()
      if (!focusables.length) return
      const activeIndex = focusables.indexOf(document.activeElement as HTMLElement)
      let nextIndex: number | null = null
      switch (e.key) {
        case 'ArrowDown':
          nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % focusables.length
          break
        case 'ArrowUp':
          nextIndex = activeIndex < 0
            ? focusables.length - 1
            : (activeIndex - 1 + focusables.length) % focusables.length
          break
        case 'Home':
          nextIndex = 0
          break
        case 'End':
          nextIndex = focusables.length - 1
          break
        case 'Tab':
          // A menu is modal for the keyboard: Tab must not escape it into the
          // next row's trigger, which is what made the menu feel unreachable.
          e.preventDefault()
          nextIndex = e.shiftKey
            ? (activeIndex <= 0 ? focusables.length - 1 : activeIndex - 1)
            : (activeIndex < 0 || activeIndex === focusables.length - 1 ? 0 : activeIndex + 1)
          break
        default:
          return
      }
      if (nextIndex === null) return
      e.preventDefault()
      focusables[nextIndex]?.focus()
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
  }, [open, updatePosition, getFocusableItems])

  // Move focus into the menu so the arrow keys have somewhere to start, and so a
  // screen reader announces the item rather than the still-focused trigger.
  //
  // Keyed on `anchorRect` rather than deferred with a timer: the panel only
  // renders once `updatePosition` has measured the trigger, which is a second
  // render, so on the first pass there is nothing to focus yet. This effect
  // re-runs when that measurement lands, by which point the portal has
  // committed. A `requestAnimationFrame` would also have waited for it, but
  // browsers throttle rAF in a background tab, so the focus could silently never
  // happen — a timer-free dependency cannot be throttled.
  React.useEffect(() => {
    if (!open || !anchorRect) return
    const [first] = getFocusableItems()
    first?.focus()
  }, [open, anchorRect, getFocusableItems])

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  if (items.length === 0) return null

  const handlePointerEnter = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch') return
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }
    setOpen(true)
  }

  const handlePointerLeave = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch') return
    hoverTimeoutRef.current = setTimeout(() => {
      setOpen(false)
    }, 150)
  }

  return (
    <div
      className="relative inline-block text-left"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <IconButton
        ref={btnRef}
        type="button"
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(true); requestAnimationFrame(updatePosition) }}
      >
        <span aria-hidden="true">⋯</span>
        <span className="sr-only">{t('ui.rowActions.openActions', 'Open actions')}</span>
      </IconButton>
      {open && anchorRect && createPortal(
        <div
          ref={menuRef}
          role="menu"
          // Sized to its longest item instead of a fixed 11rem: the items are
          // Buttons, which are `whitespace-nowrap`, so a label wider than the box
          // overflowed its right border — "Zarejestruj push ponownie" in Polish
          // overhung by ~10px (#6719). `min-w-44` keeps the old width as a floor;
          // past `max-w-xs` the items wrap instead of growing further.
          //
          // `flex flex-col` is load-bearing for that, not cosmetic. Button is
          // `inline-flex`, so under a block panel the items are inline-level and
          // `max-content` is the width of them all laid end to end — 523px here,
          // past the cap, so the panel was pinned at `max-w-xs` whatever the
          // labels said. They only looked stacked because `w-full` forced each
          // onto its own line. Blockifying them as flex items makes `max-content`
          // the widest item, which is what `w-max` was meant to measure.
          //
          // Same fix, same shape as ActionsDropdown (#3580).
          className="fixed flex flex-col w-max min-w-44 max-w-xs rounded-md border bg-background p-1 shadow focus-visible:outline-none z-dropdown"
          style={{
            top: direction === 'down' ? anchorRect.bottom + 8 : anchorRect.top - 8,
            left: Math.min(anchorRect.right, window.innerWidth - 8),
            transform: `translate(-100%, ${direction === 'down' ? '0' : '-100%'})`,
          }}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        >
          {items.map((it, idx) => (
            it.href ? (
              <a
                key={idx}
                href={it.href}
                className={`block w-full text-left px-2 py-1 text-sm rounded hover:bg-accent whitespace-normal ${it.destructive ? 'text-destructive' : ''}`}
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen(false)
                }}
              >
                {it.label}
              </a>
            ) : (
              <Button
                key={idx}
                type="button"
                variant="ghost"
                size="sm"
                // `whitespace-normal h-auto` so a label that reaches the panel's
                // max width wraps to a second line rather than overflowing: the
                // Button primitive is `whitespace-nowrap` by default (#6719).
                className={`w-full justify-start rounded-none font-normal whitespace-normal h-auto py-1.5 text-left ${it.destructive ? 'text-destructive' : ''}`}
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen(false)
                  it.onSelect?.()
                }}
              >
                {it.label}
              </Button>
            )
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
