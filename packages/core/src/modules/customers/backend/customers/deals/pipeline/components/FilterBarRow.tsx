"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { HorizontalScrollRow } from '@open-mercato/ui/primitives/time-picker'
import { ChipButton } from './ChipButton'

export type KanbanFilterChip = {
  id: 'owner' | 'people' | 'companies' | 'close'
  label: string
  value: string
}

type FilterBarRowProps = {
  /** Popover-backed chips (Status, Pipeline) rendered first, in order */
  leadingChips: React.ReactNode
  /** Static (Phase-5-stubbed) chips */
  chips: KanbanFilterChip[]
  /** Right-aligned sort chip (popover-backed) */
  sortNode: React.ReactNode
  onChipClick: (chipId: KanbanFilterChip['id']) => void
}

export function FilterBarRow({
  leadingChips,
  chips,
  sortNode,
  onChipClick,
}: FilterBarRowProps): React.ReactElement {
  const t = useT()
  // Note: the Figma mock includes a "+ Add filter" chip (1045:11987) that opens a picker for
  // Tags / Source / Currency / Created date / Updated date / Last activity / custom fields.
  // That picker is not wired up in this slice (it would need AdvancedFilterPanel integration),
  // so the affordance is intentionally omitted instead of shipping a "coming next" toast.
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 py-2 pr-3.5">
      <HorizontalScrollRow
        className="min-w-0 flex-1"
        contentClassName="flex-nowrap p-1"
        arrowSize="sm"
        edgeFade={false}
        ariaLabel={translateWithFallback(t, 'customers.deals.kanban.filter.label', 'Filter')}
        scrollLeftAriaLabel={translateWithFallback(t, 'ui.timePicker.scrollLeft', 'Scroll left')}
        scrollRightAriaLabel={translateWithFallback(t, 'ui.timePicker.scrollRight', 'Scroll right')}
      >
        {leadingChips}
        {chips.map((chip) => (
          <ChipButton
            key={chip.id}
            label={chip.label}
            value={chip.value}
            onClick={() => onChipClick(chip.id)}
            ariaLabel={translateWithFallback(
              t,
              'customers.deals.kanban.filter.aria.chip',
              'Filter by {label}',
              { label: chip.label },
            )}
          />
        ))}
      </HorizontalScrollRow>
      <div className="shrink-0">{sortNode}</div>
    </div>
  )
}

export default FilterBarRow
