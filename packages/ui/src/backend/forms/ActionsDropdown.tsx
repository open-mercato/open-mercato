"use client"

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Zap, ChevronDown, Loader2, MoreHorizontal } from 'lucide-react'
import { Button } from '../../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type ActionItem = {
  /** Unique key */
  id: string
  /** Display label */
  label: string
  /** Lucide icon component (optional) */
  icon?: React.ComponentType<{ className?: string }>
  /** Click handler */
  onSelect: () => void
  /** Disable the item */
  disabled?: boolean
  /** Show a loading spinner instead of the icon */
  loading?: boolean
  /** Render the item in the destructive token (e.g. Delete, Clear) */
  destructive?: boolean
}

/** A visual divider between groups of items. */
export type ActionSeparator = {
  /** Optional key; falls back to the array index */
  id?: string
  separator: true
}

/** A muted uppercase section label grouping the items beneath it. */
export type ActionHeader = {
  /** Optional key; falls back to the array index */
  id?: string
  /** The section label text */
  header: string
}

export type ActionMenuEntry = ActionItem | ActionSeparator | ActionHeader

export type ActionsDropdownProps = {
  /** Items to render inside the dropdown (may include separators) */
  items: ActionMenuEntry[]
  /** Button label (default: translated 'Actions') */
  label?: string
  /** Trigger style */
  triggerMode?: 'label' | 'icon'
  /** Accessible label for icon trigger */
  ariaLabel?: string
  /** Button size (default: 'sm') */
  size?: 'sm' | 'default'
  /** Extra classes for the trigger button (e.g. to match a dense toolbar row) */
  triggerClassName?: string
  /**
   * Leading icon inside the label-mode trigger. Defaults to `Zap`; pass a
   * component to override, or `false` to render just the label + chevron.
   */
  triggerIcon?: React.ComponentType<{ className?: string }> | false
  /**
   * Render a small warning dot on the trigger — for when an item inside the
   * menu needs attention (e.g. required fields still blank).
   */
  attention?: boolean
}

export function ActionsDropdown({
  items,
  label,
  triggerMode = 'label',
  ariaLabel,
  size = 'sm',
  triggerClassName,
  triggerIcon,
  attention = false,
}: ActionsDropdownProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null)
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const [direction, setDirection] = React.useState<'down' | 'up'>('down')
  /**
   * Whether this open should pull focus into the menu. Only a deliberate open
   * does — a click, or Enter/Space on the trigger, which the browser reports as
   * a click. A hover open must not steal focus from wherever the user is typing.
   * Same contract as RowActions (#6771).
   */
  const focusOnOpenRef = React.useRef(false)

  /** The menu's enabled items in DOM order, as focusable elements. */
  const getFocusableItems = React.useCallback((): HTMLElement[] => {
    if (!menuRef.current) return []
    return Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))
  }, [])

  const resolvedLabel = label ?? t('ui.actions.actions', 'Actions')
  const resolvedAriaLabel = ariaLabel ?? resolvedLabel

  const updatePosition = React.useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setAnchorRect(rect)
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    setDirection(spaceBelow < 200 && spaceAbove > spaceBelow ? 'up' : 'down')
  }, [])

  React.useEffect(() => {
    if (!open) return
    updatePosition()
    function onDocClick(event: MouseEvent) {
      const target = event.target as Node
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        btnRef.current && !btnRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    function onKey(event: KeyboardEvent) {
      // The menu also opens on hover, so keys are only handled while focus is in
      // the menu or on its trigger — otherwise a hover-opened menu would swallow
      // the arrows of someone typing elsewhere on the page.
      const active = document.activeElement
      const focusWithin = Boolean(
        (menuRef.current && active && menuRef.current.contains(active)) || (active && active === btnRef.current),
      )
      if (event.key === 'Escape') {
        setOpen(false)
        if (focusWithin) btnRef.current?.focus()
        return
      }
      if (!focusWithin) return
      // The menu is portaled to the end of `document.body`, so without this the
      // only way into it was tabbing through the rest of the page first (#6445).
      const focusables = getFocusableItems()
      if (!focusables.length) return
      const activeIndex = focusables.indexOf(active as HTMLElement)
      let nextIndex: number
      switch (event.key) {
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
          nextIndex = event.shiftKey
            ? (activeIndex <= 0 ? focusables.length - 1 : activeIndex - 1)
            : (activeIndex < 0 || activeIndex === focusables.length - 1 ? 0 : activeIndex + 1)
          break
        default:
          return
      }
      event.preventDefault()
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

  // Keyed on `anchorRect`: the panel only renders once the trigger has been
  // measured, so the first item exists only after that second render.
  React.useEffect(() => {
    if (!open) {
      focusOnOpenRef.current = false
      return
    }
    if (!anchorRect || !focusOnOpenRef.current) return
    focusOnOpenRef.current = false
    const [first] = getFocusableItems()
    first?.focus()
  }, [open, anchorRect, getFocusableItems])

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
    updatePosition()
  }

  const handleMouseLeave = (event: React.MouseEvent) => {
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && (btnRef.current?.contains(nextTarget) || menuRef.current?.contains(nextTarget))) {
      return
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setOpen(false)
    }, 150)
  }

  if (!items.length) return null

  return (
    <div
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Button
        ref={btnRef}
        type="button"
        variant="outline"
        size={size}
        className={`${triggerMode === 'icon' ? 'px-2 ' : ''}${triggerClassName ?? ''}`.trim() || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={resolvedAriaLabel}
        onClick={() => {
          focusOnOpenRef.current = true
          setOpen((prev) => !prev)
          requestAnimationFrame(updatePosition)
        }}
      >
        {triggerMode === 'icon' ? (
          <>
            <MoreHorizontal className="size-4" />
            <span className="sr-only">{resolvedAriaLabel}</span>
          </>
        ) : (
          <>
            {resolvedLabel}
            {triggerIcon === false
              ? null
              : triggerIcon
                ? React.createElement(triggerIcon, { className: 'size-4 ml-1' })
                : <Zap className="size-4 ml-1" />}
            <ChevronDown className={`size-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </Button>
      {attention && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0.5 top-0.5 size-2 rounded-full bg-status-warning-icon ring-2 ring-background"
        />
      )}
      {open && anchorRect && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed min-w-52 w-max max-w-xs rounded-md border bg-background p-1 shadow-md focus-visible:outline-none z-dropdown"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            top: direction === 'down' ? anchorRect.bottom + 4 : anchorRect.top - 4,
            left: anchorRect.right,
            transform: `translate(-100%, ${direction === 'down' ? '0' : '-100%'})`,
          }}
        >
          {items.map((item, index) => {
            if ('header' in item) {
              return (
                <div
                  key={item.id ?? `header-${index}`}
                  className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {item.header}
                </div>
              )
            }
            if ('separator' in item) {
              return (
                <div
                  key={item.id ?? `separator-${index}`}
                  role="separator"
                  className="my-1 h-px bg-border"
                />
              )
            }
            const Icon = item.icon
            return (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                size="sm"
                className={`w-full justify-start h-auto min-h-8 py-1.5 whitespace-normal text-left leading-snug${
                  item.destructive
                    ? ' text-destructive hover:text-destructive hover:bg-destructive/10 focus-visible:text-destructive'
                    : ''
                }`}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : Icon ? (
                  <Icon className="size-4" />
                ) : (
                  <span className="size-4" />
                )}
                {item.label}
              </Button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
