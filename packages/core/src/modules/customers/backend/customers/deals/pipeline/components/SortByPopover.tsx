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

export type SortOption =
  | 'updated_desc'
  | 'updated_asc'
  | 'created_desc'
  | 'value_desc'
  | 'value_asc'
  | 'probability_desc'
  | 'close_asc'
  | 'owner_asc'

export const SORT_LABEL_KEYS: Record<SortOption, { key: string; fallback: string }> = {
  updated_desc: { key: 'customers.deals.kanban.sort.option.updatedNewest', fallback: 'Updated (newest)' },
  updated_asc: { key: 'customers.deals.kanban.sort.option.updatedOldest', fallback: 'Updated (oldest)' },
  created_desc: { key: 'customers.deals.kanban.sort.option.createdNewest', fallback: 'Created (newest)' },
  value_desc: { key: 'customers.deals.kanban.sort.option.valueHigh', fallback: 'Value (high to low)' },
  value_asc: { key: 'customers.deals.kanban.sort.option.valueLow', fallback: 'Value (low to high)' },
  probability_desc: {
    key: 'customers.deals.kanban.sort.option.probabilityHigh',
    fallback: 'Probability (high to low)',
  },
  close_asc: { key: 'customers.deals.kanban.sort.option.closeSoonest', fallback: 'Close date (soonest)' },
  owner_asc: { key: 'customers.deals.kanban.sort.option.ownerAsc', fallback: 'Owner (A → Z)' },
}

const SORT_ORDER: SortOption[] = [
  'updated_desc',
  'updated_asc',
  'created_desc',
  'value_desc',
  'value_asc',
  'probability_desc',
  'close_asc',
  'owner_asc',
]

const DEFAULT_SORT: SortOption = 'updated_desc'

type SortByPopoverProps = {
  value: SortOption
  onApply: (next: SortOption) => void
}

export function SortByPopover({ value, onApply }: SortByPopoverProps): React.ReactElement {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<SortOption>(value)

  React.useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const chipLabel = translateWithFallback(t, 'customers.deals.kanban.sort.label', 'Sort')
  const chipValue = translateWithFallback(t, SORT_LABEL_KEYS[value].key, SORT_LABEL_KEYS[value].fallback)

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
        <ChipButton label={chipLabel} value={chipValue} active={value !== DEFAULT_SORT} />
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="end" onKeyDown={handleKeyDown}>
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="text-sm font-semibold text-foreground">
            {translateWithFallback(t, 'customers.deals.kanban.sort.title', 'Sort by')}
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

        <div className="flex flex-col gap-1 p-1">
          {SORT_ORDER.map((option) => {
            const isSelected = draft === option
            const isDefault = option === DEFAULT_SORT
            return (
              <button
                key={option}
                type="button"
                onClick={() => setDraft(option)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isSelected ? 'bg-muted' : ''
                }`}
              >
                <span className="flex flex-col text-left">
                  <span className="font-medium text-foreground">
                    {translateWithFallback(
                      t,
                      SORT_LABEL_KEYS[option].key,
                      SORT_LABEL_KEYS[option].fallback,
                    )}
                  </span>
                  {isDefault ? (
                    <span className="text-xs text-muted-foreground">
                      {translateWithFallback(t, 'customers.deals.kanban.sort.default', 'Default')}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`inline-flex size-4 items-center justify-center rounded-full border ${
                    isSelected ? 'border-primary bg-primary' : 'border-input'
                  }`}
                  aria-hidden="true"
                >
                  {isSelected ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : null}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground">
          <span>
            {translateWithFallback(
              t,
              'customers.deals.kanban.sort.defaultHint',
              'Default: {label}',
              {
                label: translateWithFallback(
                  t,
                  SORT_LABEL_KEYS[DEFAULT_SORT].key,
                  SORT_LABEL_KEYS[DEFAULT_SORT].fallback,
                ),
              },
            )}
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

export default SortByPopover
