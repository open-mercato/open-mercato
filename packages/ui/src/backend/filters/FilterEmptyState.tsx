'use client'
import * as React from 'react'
import { Filter, Plus } from 'lucide-react'
import { Button } from '../../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type FilterEmptyStateProps = {
  onAddCondition: () => void
  addConditionRef: React.RefObject<HTMLButtonElement | null>
  aiSlot?: React.ReactNode
  quickFilters?: React.ReactNode
}

export function FilterEmptyState({ onAddCondition, addConditionRef, aiSlot, quickFilters }: FilterEmptyStateProps) {
  const t = useT()
  return (
    <div className="flex flex-col items-stretch gap-4 p-2" data-testid="filter-empty-state">
      <div className="flex flex-col items-center text-center py-6 gap-3">
        <div className="flex size-14 items-center justify-center rounded-full bg-brand-violet/10">
          <Filter className="size-6 text-brand-violet" />
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-base font-semibold">
            {t('ui.advancedFilter.empty.title', 'No filters applied')}
          </div>
          <div className="text-sm text-muted-foreground max-w-md">
            {t('ui.advancedFilter.empty.subtitle', 'Add a condition to narrow down the list, or describe what you want in natural language.')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            ref={addConditionRef}
            onClick={onAddCondition}
            className="bg-brand-violet text-brand-violet-foreground hover:bg-brand-violet/90"
          >
            <Plus className="size-4" />
            {t('ui.advancedFilter.empty.addCondition', 'Add condition')}
          </Button>
          {aiSlot}
        </div>
      </div>
      {quickFilters ? (
        <>
          <div className="border-t border-border" />
          {quickFilters}
        </>
      ) : null}
    </div>
  )
}
