"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
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
  onAddFilterClick: () => void
}

export function FilterBarRow({
  leadingChips,
  chips,
  sortNode,
  onChipClick,
  onAddFilterClick,
}: FilterBarRowProps): React.ReactElement {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center justify-between gap-y-2 rounded-lg bg-muted/40 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-overline font-bold uppercase leading-normal text-muted-foreground">
          {translateWithFallback(t, 'customers.deals.kanban.filter.label', 'Filter')}:
        </span>
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
        <ChipButton
          onClick={onAddFilterClick}
          withChevron={false}
          value={translateWithFallback(t, 'customers.deals.kanban.filter.add', '+ More')}
          ariaLabel={translateWithFallback(t, 'customers.deals.kanban.filter.more', 'More filters')}
        />
      </div>
      <div className="ml-auto">{sortNode}</div>
    </div>
  )
}

export default FilterBarRow
