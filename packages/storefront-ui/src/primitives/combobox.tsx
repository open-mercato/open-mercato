'use client'

import * as React from 'react'
import { cn } from '../lib/cn'
import { SearchIcon, XIcon } from '../lib/icons'
import { inputVariants } from './input'

export type ComboboxItem = {
  id: string
  label: React.ReactNode
  description?: React.ReactNode
  /** Items with the same group render under one heading; order follows first appearance. */
  group?: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
  disabled?: boolean
}

export type ComboboxProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'size' | 'onSelect'> & {
  value: string
  onValueChange: (value: string) => void
  items: ComboboxItem[]
  onSelect: (item: ComboboxItem) => void
  /** Accessible name of the input and of the listbox. */
  label: string
  /** Shown while open and `items` is empty. */
  empty?: React.ReactNode
  /** Rendered under the list: "See all results", "Enter address manually". */
  footer?: React.ReactNode
  /** Rendered above the list while the input is empty: recent and popular searches. */
  idle?: React.ReactNode
  clearLabel?: string
  size?: 'default' | 'lg'
  /** `quiet` is a filled field without a border (site header); `inverse` is the same on a primary-coloured surface or a photo. */
  tone?: 'default' | 'quiet' | 'inverse'
  leadingIcon?: React.ReactNode | false
  /** Open the list on focus even with an empty value. */
  openOnFocus?: boolean
}

const toneClass = {
  default: undefined,
  quiet: 'border-transparent bg-sf-surface hover:border-transparent hover:bg-sf-surface-tint',
  inverse: 'border-transparent bg-sf-primary-soft text-primary-foreground placeholder:text-primary-foreground/80 hover:border-transparent focus-visible:border-primary-foreground',
}

/**
 * Editable combobox (WAI-ARIA 1.2, list autocomplete) for search typeahead and address
 * lookup. Built on a positioned listbox rather than a Radix popover so the input keeps focus.
 */
export const Combobox = React.forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  { value, onValueChange, items, onSelect, label, empty, footer, idle, clearLabel, size = 'default', tone = 'default', leadingIcon, openOnFocus = true, className, onKeyDown, onFocus, onBlur, id, ...props },
  ref,
) {
  const generated = React.useId()
  const inputId = id ?? generated
  const listId = `${inputId}-listbox`
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const enabled = items.filter((item) => !item.disabled)
  const showIdle = Boolean(idle) && value.length === 0
  const showList = open && (showIdle || items.length > 0 || Boolean(empty) || Boolean(footer))

  React.useEffect(() => { setActive(-1) }, [items])

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const choose = (item: ComboboxItem) => {
    if (item.disabled) return
    onSelect(item)
    setOpen(false)
  }

  const groups = new Map<string | undefined, ComboboxItem[]>()
  items.forEach((item) => {
    const list = groups.get(item.group) ?? []
    list.push(item)
    groups.set(item.group, list)
  })
  const activeItem = active >= 0 ? enabled[active] : undefined
  const adornment = tone === 'inverse' ? 'text-primary-foreground' : 'text-muted-foreground'

  return (
    <div ref={rootRef} data-slot="combobox" data-tone={tone} className="relative w-full">
      <span className="relative flex items-center">
        {leadingIcon === false ? null : (
          <span aria-hidden="true" className={cn('pointer-events-none absolute left-4 flex [&_svg]:size-4.5', adornment)}>{leadingIcon ?? <SearchIcon />}</span>
        )}
        <input
          ref={ref}
          id={inputId}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={activeItem ? `${listId}-${activeItem.id}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => { onValueChange(event.target.value); setOpen(true) }}
          onFocus={(event) => { onFocus?.(event); if (openOnFocus || value) setOpen(true) }}
          onBlur={(event) => { onBlur?.(event) }}
          onKeyDown={(event) => {
            onKeyDown?.(event)
            if (event.defaultPrevented) return
            if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((current) => Math.min(enabled.length - 1, current + 1)) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => Math.max(-1, current - 1)) }
            else if (event.key === 'Enter' && activeItem) { event.preventDefault(); choose(activeItem) }
            else if (event.key === 'Escape') { event.preventDefault(); if (open) setOpen(false); else if (value) onValueChange('') }
          }}
          className={cn(inputVariants({ size }), toneClass[tone], leadingIcon === false ? undefined : 'pl-11', value && clearLabel ? 'pr-11' : undefined, className)}
          {...props}
        />
        {value && clearLabel ? (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() => { onValueChange(''); setOpen(true) }}
            className={cn('absolute right-1 flex size-8 cursor-pointer items-center justify-center rounded-sf-chip outline-none focus-visible:shadow-focus [&_svg]:size-4', adornment, tone === 'inverse' ? undefined : 'hover:text-foreground')}
          >
            <XIcon />
          </button>
        ) : null}
      </span>
      {showList ? (
        <div
          data-slot="combobox-panel"
          className="absolute left-0 right-0 top-full z-dropdown mt-2 flex max-h-96 flex-col overflow-hidden rounded-sf-field border border-border bg-popover text-popover-foreground shadow-md"
        >
          {showIdle ? <div className="overflow-y-auto p-3">{idle}</div> : null}
          <div id={listId} role="listbox" aria-label={label} className={cn('overflow-y-auto p-1.5', showIdle && items.length === 0 && 'hidden')}>
            {items.length === 0 && !showIdle && empty ? <div className="px-3 py-2.5 text-sf-body-sm text-muted-foreground">{empty}</div> : null}
            {Array.from(groups.entries()).map(([group, groupItems]) => (
              <div key={group ?? '__default'} role={group ? 'group' : undefined} aria-label={group}>
                {group ? <div className="px-3 pb-1 pt-2 text-sf-body-xs text-muted-foreground">{group}</div> : null}
                {groupItems.map((item) => {
                  const isActive = activeItem?.id === item.id
                  return (
                    <div
                      key={item.id}
                      id={`${listId}-${item.id}`}
                      role="option"
                      aria-selected={isActive}
                      aria-disabled={item.disabled || undefined}
                      onMouseEnter={() => setActive(enabled.indexOf(item))}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(item)}
                      className={cn(
                        'flex min-h-11 cursor-pointer items-center gap-3 rounded-sf-chip px-3 py-2 text-sf-body text-foreground',
                        isActive && 'bg-muted',
                        item.disabled && 'cursor-not-allowed text-text-disabled',
                      )}
                    >
                      {item.leading}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{item.label}</span>
                        {item.description ? <span className="truncate text-sf-body-xs text-muted-foreground">{item.description}</span> : null}
                      </span>
                      {item.trailing ? <span className="shrink-0 text-sf-body-sm">{item.trailing}</span> : null}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          {footer ? <div className="border-t border-border p-2 [&_a]:block [&_a]:rounded-sf-chip [&_a]:px-3 [&_a]:py-2.5 [&_a]:text-sf-body-sm [&_a]:hover:bg-muted [&_button]:block [&_button]:w-full [&_button]:rounded-sf-chip [&_button]:px-3 [&_button]:py-2.5 [&_button]:text-left [&_button]:text-sf-body-sm [&_button]:hover:bg-muted">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  )
})
