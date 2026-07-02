"use client"

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { CONTROL_BORDER, DROPDOWN_PANEL_CLASS } from './inputs'

// Category rows render as a small color dot + plain label (no uppercase pills)
// so the picker stays readable in both themes and long lists scan easily.
function CategoryRow({ label, color }: { label: string; color: string | null }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm text-foreground">
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
        style={color ? { backgroundColor: color, borderColor: color } : undefined}
      />
      <span className="truncate">{label}</span>
    </span>
  )
}

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
          'h-9 w-full justify-between bg-background px-3 font-normal shadow-none',
          CONTROL_BORDER,
        )}
      >
        <CategoryRow label={selected.label} color={colors[selected.value] ?? null} />
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
              className={cn(
                'h-auto w-full justify-start px-2 py-1.5 text-left font-normal',
                option.value === value && 'bg-muted',
              )}
            >
              <CategoryRow label={option.label} color={colors[option.value] ?? null} />
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
