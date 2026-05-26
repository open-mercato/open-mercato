'use client'
import * as React from 'react'
import { SearchX, Undo2 } from 'lucide-react'
import { Button } from '../../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type FilteredEmptyResultsProps = {
  entityNamePlural: string
  canRemoveLast: boolean
  onClearAll: () => void
  onRemoveLast: () => void
}

export function FilteredEmptyResults({ entityNamePlural, canRemoveLast, onClearAll, onRemoveLast }: FilteredEmptyResultsProps) {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12" data-testid="filtered-empty-results">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <SearchX className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="text-base font-semibold">
          {t('ui.advancedFilter.empty.noMatches', 'No {entity} match these filters', { entity: entityNamePlural })}
        </div>
        <div className="text-sm text-muted-foreground max-w-md text-center">
          {t('ui.advancedFilter.empty.tryRemoving', 'Try removing the most restrictive filter, or clear all filters to see everyone.')}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" onClick={onClearAll}>
          {t('ui.advancedFilter.empty.clearAll', 'Clear all filters')}
        </Button>
        <Button type="button" variant="outline" disabled={!canRemoveLast} onClick={onRemoveLast}>
          <Undo2 className="size-4" />
          {t('ui.advancedFilter.empty.removeLast', 'Remove last filter')}
        </Button>
      </div>
    </div>
  )
}
