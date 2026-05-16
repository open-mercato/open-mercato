"use client"

import * as React from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { ChipButton } from './ChipButton'
import { FilterPopoverShell } from './FilterPopoverShell'

export type CloseDateRange = {
  from: string | null
  to: string | null
}

type CloseDateFilterPopoverProps = {
  value: CloseDateRange
  onApply: (next: CloseDateRange) => void
}

type PresetKey = 'next-30' | 'next-90' | 'this-month' | 'this-quarter' | 'overdue' | 'custom'

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function startOfMonth(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(1)
  return d
}

function endOfMonth(): Date {
  const d = startOfMonth()
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return d
}

function startOfQuarter(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(1)
  const m = d.getUTCMonth()
  d.setUTCMonth(m - (m % 3))
  return d
}

function endOfQuarter(): Date {
  const d = startOfQuarter()
  d.setUTCMonth(d.getUTCMonth() + 3)
  d.setUTCDate(0)
  return d
}

function buildPresetRange(key: PresetKey): CloseDateRange {
  const now = new Date()
  now.setUTCHours(0, 0, 0, 0)
  switch (key) {
    case 'next-30': {
      const to = new Date(now)
      to.setUTCDate(to.getUTCDate() + 30)
      return { from: ymd(now), to: ymd(to) }
    }
    case 'next-90': {
      const to = new Date(now)
      to.setUTCDate(to.getUTCDate() + 90)
      return { from: ymd(now), to: ymd(to) }
    }
    case 'this-month':
      return { from: ymd(startOfMonth()), to: ymd(endOfMonth()) }
    case 'this-quarter':
      return { from: ymd(startOfQuarter()), to: ymd(endOfQuarter()) }
    case 'overdue': {
      const yesterday = new Date(now)
      yesterday.setUTCDate(yesterday.getUTCDate() - 1)
      return { from: null, to: ymd(yesterday) }
    }
    default:
      return { from: null, to: null }
  }
}

export function CloseDateFilterPopover({ value, onApply }: CloseDateFilterPopoverProps): React.ReactElement {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<CloseDateRange>(value)

  React.useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const isActive = !!(value.from || value.to)
  const chipLabel = translateWithFallback(t, 'customers.deals.kanban.filter.close', 'Close')
  const chipValue = React.useMemo(() => {
    // Show "Any" (not "Next 90 days") when no filter is applied — the previous label was a
    // preset name, which read like the filter was already active and confused operators.
    if (!isActive) return translateWithFallback(t, 'customers.deals.kanban.filter.any', 'Any')
    if (value.from && value.to) {
      const f = new Date(value.from).toLocaleDateString(undefined, { month: 'short', day: '2-digit' })
      const tt = new Date(value.to).toLocaleDateString(undefined, { month: 'short', day: '2-digit' })
      return `${f} – ${tt}`
    }
    if (value.from && !value.to)
      return translateWithFallback(t, 'customers.deals.kanban.filter.from', 'From {date}', {
        date: new Date(value.from).toLocaleDateString(undefined, { month: 'short', day: '2-digit' }),
      })
    if (!value.from && value.to)
      return translateWithFallback(t, 'customers.deals.kanban.filter.until', 'Until {date}', {
        date: new Date(value.to).toLocaleDateString(undefined, { month: 'short', day: '2-digit' }),
      })
    return ''
  }, [value.from, value.to, isActive, t])

  const applyPreset = (key: PresetKey) => setDraft(buildPresetRange(key))

  const handleApply = () => {
    onApply({
      from: draft.from && draft.from.length ? draft.from : null,
      to: draft.to && draft.to.length ? draft.to : null,
    })
    setOpen(false)
  }
  const handleClear = () => setDraft({ from: null, to: null })

  // Cmd/Ctrl+Enter from anywhere inside the popover confirms — parity with the dialog
  // primary-action shortcut (`AGENTS.md` UI Interaction rules).
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleApply()
    }
  }

  const hasDraft = !!(draft.from || draft.to)
  const footerLeft = (
    <div className="flex items-center gap-3">
      <span>
        {hasDraft
          ? translateWithFallback(t, 'customers.deals.kanban.filter.dateRange.applied', 'Range set')
          : translateWithFallback(t, 'customers.deals.kanban.filter.any', 'Any')}
      </span>
      {hasDraft ? (
        <button
          type="button"
          onClick={handleClear}
          className="text-[12px] font-medium leading-normal text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {translateWithFallback(t, 'customers.deals.kanban.filter.clear', 'Clear')}
        </button>
      ) : null}
    </div>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton label={chipLabel} value={chipValue} active={isActive} />
      </PopoverTrigger>
      <PopoverContent
        className="w-80 rounded-2xl border-border bg-transparent p-0 shadow-xl"
        align="start"
        onKeyDown={handleKeyDown}
      >
        <FilterPopoverShell
          title={translateWithFallback(t, 'customers.deals.kanban.filter.close.title', 'Filter · Expected close')}
          onClose={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          onApply={handleApply}
          footerLeft={footerLeft}
        >
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { key: 'next-30', label: translateWithFallback(t, 'customers.deals.kanban.filter.preset.next30', 'Next 30 days') },
                { key: 'next-90', label: translateWithFallback(t, 'customers.deals.kanban.filter.preset.next90', 'Next 90 days') },
                { key: 'this-month', label: translateWithFallback(t, 'customers.deals.kanban.filter.preset.thisMonth', 'This month') },
                { key: 'this-quarter', label: translateWithFallback(t, 'customers.deals.kanban.filter.preset.thisQuarter', 'This quarter') },
                { key: 'overdue', label: translateWithFallback(t, 'customers.deals.kanban.filter.preset.overdue', 'Overdue') },
              ] as Array<{ key: PresetKey; label: string }>
            ).map((preset) => (
              <Button
                variant="outline"
                size="sm"
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset.key)}
                className="h-auto rounded-full border-border bg-card px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {translateWithFallback(t, 'customers.deals.kanban.filter.fromLabel', 'From')}
              <input
                type="date"
                value={draft.from ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, from: e.target.value || null }))}
                className="rounded-md border border-input bg-card px-2.5 py-1.5 text-[13px] font-normal leading-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {translateWithFallback(t, 'customers.deals.kanban.filter.toLabel', 'To')}
              <input
                type="date"
                value={draft.to ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, to: e.target.value || null }))}
                className="rounded-md border border-input bg-card px-2.5 py-1.5 text-[13px] font-normal leading-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
        </FilterPopoverShell>
      </PopoverContent>
    </Popover>
  )
}

export default CloseDateFilterPopover
