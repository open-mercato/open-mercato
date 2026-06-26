"use client"

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { categoryPillStyle, CONTROL_BORDER, DROPDOWN_PANEL_CLASS, UppercaseBadge } from './inputs'

export function CategoryField({
  label,
  value,
  options,
  colors,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  colors: Record<string, string | null>
  onChange(next: string): void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const selected = options.find((option) => option.value === value) ?? { value, label: value }

  return (
    <div
      className="relative w-full"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <Button
        type="button"
        variant="outline"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((previous) => !previous)}
        className={cn(
          'h-9 w-full justify-between bg-background px-3 shadow-none',
          CONTROL_BORDER,
        )}
      >
        <UppercaseBadge style={categoryPillStyle(colors[selected.value] ?? null)}>{selected.label}</UppercaseBadge>
        <span className="flex shrink-0 items-center">
          <span aria-hidden className="h-px w-2" />
          <ChevronDown aria-hidden className="size-4 opacity-60" />
        </span>
      </Button>
      {open ? (
        <div role="listbox" aria-label={label} className={DROPDOWN_PANEL_CLASS}>
          {options.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t('customers.calendar.editor.noResults', 'No results')}
            </p>
          ) : null}
          {options.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className="h-auto w-full justify-start px-2 py-1.5 text-left"
            >
              <UppercaseBadge style={categoryPillStyle(colors[option.value] ?? null)}>{option.label}</UppercaseBadge>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
