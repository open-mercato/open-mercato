"use client"

import * as React from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'

export const CONTROL_BORDER = 'border border-input'
export const CONTROL_TEXT = 'text-sm text-foreground placeholder:text-muted-foreground'
export const LABEL_CLASS = 'text-xs font-medium text-muted-foreground'
export const DROPDOWN_PANEL_CLASS =
  'absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'

export function Field({ label, children, error, className }: { label: string; children: React.ReactNode; error?: string | null; className?: string }) {
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      <span className={LABEL_CLASS}>{label}</span>
      {children}
      {error ? <p className="text-xs text-status-error-text">{error}</p> : null}
    </div>
  )
}

export function UppercaseBadge({ style, className, children }: { style?: React.CSSProperties; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-muted px-2 py-0.5 text-overline font-medium uppercase text-muted-foreground',
        className,
      )}
      style={style}
    >
      {children}
    </span>
  )
}

export function AllDayToggle({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange(next: boolean): void; label: string }) {
  return (
    <Switch
      checked={checked}
      aria-label={label}
      onCheckedChange={onCheckedChange}
      className="h-6 w-10"
    />
  )
}

function formatDisplayDate(value: string, locale: string): string {
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(parsed)
}

export function DateControl({
  value,
  onChange,
  ariaLabel,
  locale,
  className,
}: {
  value: string
  onChange(next: string): void
  ariaLabel: string
  locale: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative flex h-9 w-full items-center justify-between rounded-md bg-background px-3',
        CONTROL_BORDER,
        className,
      )}
    >
      <span className="truncate text-sm text-foreground">{formatDisplayDate(value, locale)}</span>
      <span aria-hidden className="h-px w-2 shrink-0" />
      <ChevronDown aria-hidden className="size-4 shrink-0 opacity-60" />
      <Input
        type="date"
        value={value}
        onChange={(event) => { if (event.target.value) onChange(event.target.value) }}
        aria-label={ariaLabel}
        className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0 shadow-none hover:bg-transparent"
        inputClassName="h-full cursor-pointer"
      />
    </div>
  )
}

export function TimeControl({ value, onChange, ariaLabel }: { value: string; onChange(next: string): void; ariaLabel: string }) {
  return (
    <Input
      type="time"
      value={value}
      onChange={(event) => { if (event.target.value) onChange(event.target.value) }}
      aria-label={ariaLabel}
      className="h-9 w-32 shrink-0"
    />
  )
}

export function PersonChip({
  name,
  badge,
  compact,
  onRemove,
  removeLabel,
}: {
  name: string
  badge?: React.ReactNode
  compact?: boolean
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted pl-1 pr-2',
        compact ? 'py-0.5' : 'py-1',
      )}
    >
      <Avatar size="xs" label={name} />
      <span className="max-w-40 truncate text-xs font-medium text-foreground">{name}</span>
      {badge}
      {onRemove ? (
        <IconButton
          variant="ghost"
          size="xs"
          onClick={(event) => { event.stopPropagation(); onRemove() }}
          aria-label={removeLabel}
          className="size-5 shrink-0"
        >
          <Plus aria-hidden className="size-3.5 rotate-45 opacity-50" />
        </IconButton>
      ) : null}
    </span>
  )
}
