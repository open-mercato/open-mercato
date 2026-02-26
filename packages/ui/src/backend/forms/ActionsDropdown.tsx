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
}

export type ActionsDropdownProps = {
  /** Items to render inside the dropdown */
  items: ActionItem[]
  /** Button label (default: translated 'Actions') */
  label?: string
  /** Trigger style */
  triggerMode?: 'label' | 'icon'
  /** Accessible label for icon trigger */
  ariaLabel?: string
  /** Button size (default: 'sm') */
  size?: 'sm' | 'default'
}

export function ActionsDropdown({
  items,
  label,
  triggerMode = 'label',
  ariaLabel,
  size = 'sm',
}: ActionsDropdownProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null)
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const [direction, setDirection] = React.useState<'down' | 'up'>('down')

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
      if (event.key === 'Escape') {
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
        className={triggerMode === 'icon' ? 'px-2' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={resolvedAriaLabel}
        onClick={() => {
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
            <Zap className="size-4 ml-1" />
            <ChevronDown className={`size-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </Button>
      {open && anchorRect && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed w-52 rounded-md border bg-background p-1 shadow-md focus:outline-none z-[1000]"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            top: direction === 'down' ? anchorRect.bottom + 4 : anchorRect.top - 4,
            left: anchorRect.right,
            transform: `translate(-100%, ${direction === 'down' ? '0' : '-100%'})`,
          }}
        >
          {items.map((item) => {
            const Icon = item.icon
            return (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
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
