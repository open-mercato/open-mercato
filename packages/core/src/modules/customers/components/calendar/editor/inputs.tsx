"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Switch } from '@open-mercato/ui/primitives/switch'

export const CONTROL_BORDER = 'border border-input'
export const CONTROL_TEXT = 'text-sm text-foreground placeholder:text-muted-foreground'
export const LABEL_CLASS = 'text-xs font-medium text-muted-foreground'
export const DROPDOWN_PANEL_CLASS =
  'absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'

/**
 * Closes an editor dropdown on pointer-down outside the component or Escape.
 * Blur alone is unreliable inside the Radix dialog focus trap (#3552 feedback:
 * the Resources list stayed open), so dismissal listens on the document while
 * the dropdown is open. Returns the ref to attach to the component root.
 */
export function useDropdownDismiss(open: boolean, onClose: () => void): React.RefObject<HTMLDivElement | null> {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Swallow Escape so the dialog itself stays open.
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, onClose])
  return rootRef
}

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

function parseDateValue(value: string): Date | null {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Close the field's popover when the surrounding editor dialog scrolls, so a
// portalled DS popover (DatePicker/Select) doesn't float over the form or drift
// from its field (#3747 feedback). Radix ignores synthetic dismiss events, so
// this drives the popover's controlled `open` state instead. The editor
// dispatches `EDITOR_SCROLL_EVENT` on scroll.
export const EDITOR_SCROLL_EVENT = 'om-calendar-editor-scroll'
function useCloseOnEditorScroll(setOpen: (open: boolean) => void) {
  React.useEffect(() => {
    const handler = () => setOpen(false)
    document.addEventListener(EDITOR_SCROLL_EVENT, handler)
    return () => document.removeEventListener(EDITOR_SCROLL_EVENT, handler)
  }, [setOpen])
}

// DS DatePicker (calendar popover) + DS Select (scrolling 30-min list) replace
// the native `<input type=date|time>` overlays, which only opened via the
// browser chevron and did not match the design system (#3747 feedback).
export function DateControl({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  value: string
  onChange(next: string): void
  ariaLabel: string
  locale: string
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  useCloseOnEditorScroll(setOpen)
  return (
    <DatePicker
      value={parseDateValue(value)}
      onChange={(date) => { if (date) onChange(formatDateValue(date)) }}
      footer="none"
      open={open}
      onOpenChange={setOpen}
      aria-label={ariaLabel}
      className={cn('w-full', className)}
    />
  )
}

// 24h times at 30-minute steps.
const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2)
  const minute = index % 2 === 0 ? '00' : '30'
  return `${String(hour).padStart(2, '0')}:${minute}`
})

export function TimeControl({ value, onChange, ariaLabel }: { value: string; onChange(next: string): void; ariaLabel: string }) {
  const [open, setOpen] = React.useState(false)
  useCloseOnEditorScroll(setOpen)
  // Keep an off-grid value (e.g. an imported 22:15) selectable.
  const options = value && !TIME_OPTIONS.includes(value) ? [value, ...TIME_OPTIONS] : TIME_OPTIONS
  return (
    <Select value={value} onValueChange={onChange} open={open} onOpenChange={setOpen}>
      <SelectTrigger aria-label={ariaLabel} className="h-9 w-32 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {options.map((time) => (
          <SelectItem key={time} value={time}>{time}</SelectItem>
        ))}
      </SelectContent>
    </Select>
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
