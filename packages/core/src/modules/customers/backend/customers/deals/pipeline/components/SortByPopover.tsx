"use client"

import * as React from 'react'
import { Tag } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { ChipButton } from './ChipButton'
import { FilterPopoverShell } from './FilterPopoverShell'

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

function RadioDot({ selected }: { selected: boolean }): React.ReactElement {
  return (
    <span
      className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
        selected ? 'border-accent-indigo' : 'border-input bg-card'
      }`}
      aria-hidden="true"
    >
      {selected ? <span className="size-2 rounded-full bg-accent-indigo" /> : null}
    </span>
  )
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

  const footerLeft = (
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
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton label={chipLabel} value={chipValue} active={value !== DEFAULT_SORT} />
      </PopoverTrigger>
      <PopoverContent
        className="w-96 rounded-2xl border-border bg-transparent p-0 shadow-xl"
        align="end"
        onKeyDown={handleKeyDown}
      >
        <FilterPopoverShell
          title={translateWithFallback(t, 'customers.deals.kanban.sort.title', 'Sort by')}
          leadingIcon={<Tag className="size-4" />}
          onClose={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          onApply={handleApply}
          footerLeft={footerLeft}
        >
          {SORT_ORDER.map((option) => {
            const isSelected = draft === option
            const isDefault = option === DEFAULT_SORT
            const rowClass = isSelected ? 'bg-muted' : 'bg-card'
            return (
              <button
                key={option}
                type="button"
                onClick={() => setDraft(option)}
                className={`flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${rowClass}`}
              >
                <RadioDot selected={isSelected} />
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span
                    className={`text-[13px] leading-normal text-foreground ${
                      isSelected ? 'font-semibold' : 'font-normal'
                    }`}
                  >
                    {translateWithFallback(
                      t,
                      SORT_LABEL_KEYS[option].key,
                      SORT_LABEL_KEYS[option].fallback,
                    )}
                  </span>
                  {isDefault && isSelected ? (
                    <span className="text-[11px] font-normal leading-normal text-muted-foreground">
                      {translateWithFallback(t, 'customers.deals.kanban.sort.default', 'Default')}
                    </span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </FilterPopoverShell>
      </PopoverContent>
    </Popover>
  )
}

export default SortByPopover
