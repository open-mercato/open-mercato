"use client"

import * as React from 'react'
import { X } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { ChipButton } from './ChipButton'

/**
 * Filter options exposed to the operator.
 *
 * The deal `status` column accepts the historical 4-value enum (`open` | `closed` | `win` |
 * `loose`), but the codebase only ever **writes** `loose` for a lost deal — `closed` was a
 * latent unused state from an earlier iteration. Exposing a separate "Lost (closed)" filter
 * option therefore filtered to nothing and confused operators. We display a single "Lost"
 * choice and intentionally map it to the canonical wire value `loose` so the filter matches
 * what the rest of the app actually persists. (Renaming the column / migrating the data to
 * `lost` is a deeper data-model change tracked separately.)
 */
const STATUS_OPTIONS: Array<{
  value: string
  labelKey: string
  labelFallback: string
  tone: 'success' | 'error' | 'warning' | 'info' | 'neutral'
}> = [
  { value: 'open', labelKey: 'customers.deals.kanban.filter.status.open', labelFallback: 'Open', tone: 'success' },
  { value: 'win', labelKey: 'customers.deals.kanban.filter.status.won', labelFallback: 'Won', tone: 'warning' },
  { value: 'loose', labelKey: 'customers.deals.kanban.filter.status.lost', labelFallback: 'Lost', tone: 'neutral' },
]

const TONE_BG: Record<(typeof STATUS_OPTIONS)[number]['tone'], string> = {
  success: 'bg-status-success-bg text-status-success-text border-status-success-border',
  error: 'bg-status-error-bg text-status-error-text border-status-error-border',
  warning: 'bg-status-warning-bg text-status-warning-text border-status-warning-border',
  info: 'bg-status-info-bg text-status-info-text border-status-info-border',
  neutral: 'bg-status-neutral-bg text-status-neutral-text border-status-neutral-border',
}

type StatusFilterPopoverProps = {
  values: string[]
  onApply: (next: string[]) => void
}

export function StatusFilterPopover({ values, onApply }: StatusFilterPopoverProps): React.ReactElement {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<string[]>(values)

  React.useEffect(() => {
    if (open) setDraft(values)
  }, [open, values])

  const chipLabel = translateWithFallback(t, 'customers.deals.kanban.filter.status', 'Status')
  const chipValue =
    values.length === 0
      ? translateWithFallback(t, 'customers.deals.kanban.filter.all', 'All')
      : values
          .map((value) => {
            const option = STATUS_OPTIONS.find((entry) => entry.value === value)
            return option
              ? translateWithFallback(t, option.labelKey, option.labelFallback)
              : value
          })
          .join(', ')

  const toggleDraft = (value: string) => {
    setDraft((prev) =>
      prev.includes(value) ? prev.filter((entry) => entry !== value) : [...prev, value],
    )
  }

  const handleApply = () => {
    onApply(draft)
    setOpen(false)
  }

  // Cmd/Ctrl+Enter from anywhere inside the popover confirms — parity with the dialog
  // primary-action shortcut (`AGENTS.md` UI Interaction rules).
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleApply()
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton label={chipLabel} value={chipValue} active={values.length > 0} />
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start" onKeyDown={handleKeyDown}>
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="text-sm font-semibold text-foreground">
            {translateWithFallback(t, 'customers.deals.kanban.filter.status.title', 'Filter · Status')}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={translateWithFallback(t, 'customers.deals.kanban.filter.close', 'Close')}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 p-3">
          {STATUS_OPTIONS.map((option) => {
            const isSelected = draft.includes(option.value)
            const label = translateWithFallback(t, option.labelKey, option.labelFallback)
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleDraft(option.value)}
                aria-pressed={isSelected}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isSelected ? TONE_BG[option.tone] : 'border-input bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="size-2 rounded-full bg-current" aria-hidden="true" />
                <span>{label}</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground">
          <span>
            {draft.length}{' '}
            {translateWithFallback(t, 'customers.deals.kanban.filter.selected', 'selected')}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setOpen(false)}>
              {translateWithFallback(t, 'customers.deals.kanban.filter.cancel', 'Cancel')}
            </Button>
            <Button size="sm" type="button" onClick={handleApply}>
              {translateWithFallback(t, 'customers.deals.kanban.filter.apply', 'Apply')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default StatusFilterPopover
