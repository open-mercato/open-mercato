"use client"

import * as React from 'react'
import { X } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { ChipButton } from './ChipButton'
import { FilterPopoverShell } from './FilterPopoverShell'

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
  /** Tone selects the small ●-dot color on the pill (per Figma: green / amber / gray) */
  dotClass: string
}> = [
  {
    value: 'open',
    labelKey: 'customers.deals.kanban.filter.status.open',
    labelFallback: 'Open',
    dotClass: 'bg-status-success-icon',
  },
  {
    value: 'win',
    labelKey: 'customers.deals.kanban.filter.status.won',
    labelFallback: 'Won',
    dotClass: 'bg-status-warning-icon',
  },
  {
    value: 'loose',
    labelKey: 'customers.deals.kanban.filter.status.lost',
    labelFallback: 'Lost',
    dotClass: 'bg-status-neutral-icon',
  },
]

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
      <PopoverContent
        className="w-96 rounded-2xl border-border bg-transparent p-0 shadow-xl"
        align="start"
        onKeyDown={handleKeyDown}
      >
        <FilterPopoverShell
          title={
            <>
              <span className="font-bold">
                {translateWithFallback(t, 'customers.deals.kanban.filter.status.title.label', 'Filter : ')}
              </span>
              <span className="font-normal">
                {translateWithFallback(t, 'customers.deals.kanban.filter.status', 'Status')}
              </span>
            </>
          }
          onClose={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          onApply={handleApply}
          footerLeft={
            <span>
              {draft.length}{' '}
              {translateWithFallback(t, 'customers.deals.kanban.filter.selected', 'selected')}
            </span>
          }
        >
          <span className="text-xs font-semibold uppercase leading-normal tracking-wide text-muted-foreground">
            {translateWithFallback(t, 'customers.deals.kanban.filter.status', 'Status')}
          </span>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            {STATUS_OPTIONS.map((option) => {
              const isSelected = draft.includes(option.value)
              const label = translateWithFallback(t, option.labelKey, option.labelFallback)
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleDraft(option.value)}
                  aria-pressed={isSelected}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs leading-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    isSelected
                      ? 'bg-muted font-semibold text-foreground'
                      : 'border border-border bg-card font-normal text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block size-2 shrink-0 rounded-full ${option.dotClass}`}
                    aria-hidden="true"
                  />
                  <span>{label}</span>
                  {isSelected ? (
                    <X className="size-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : null}
                </button>
              )
            })}
          </div>
        </FilterPopoverShell>
      </PopoverContent>
    </Popover>
  )
}

export default StatusFilterPopover
