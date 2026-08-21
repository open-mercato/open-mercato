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
  /**
   * When provided, a search is ALSO active alongside the filters. Switches the
   * copy to a combined search+filter message and makes the primary action clear
   * both the search and the filters (so a single click shows everyone).
   */
  onClearSearch?: () => void
}

export function FilteredEmptyResults({ entityNamePlural, canRemoveLast, onClearAll, onRemoveLast, onClearSearch }: FilteredEmptyResultsProps) {
  const t = useT()
  const searchActive = typeof onClearSearch === 'function'
  const title = searchActive
    ? t('ui.advancedFilter.empty.noMatchesSearchFilters', 'No {entity} match your search and filters', { entity: entityNamePlural })
    : t('ui.advancedFilter.empty.noMatches', 'No {entity} match these filters', { entity: entityNamePlural })
  const description = searchActive
    ? t('ui.advancedFilter.empty.tryRemovingSearchFilters', 'Try a different search, remove a filter, or clear everything to see everyone.')
    : t('ui.advancedFilter.empty.tryRemoving', 'Try removing the most restrictive filter, or clear all filters to see everyone.')
  const primaryLabel = searchActive
    ? t('ui.advancedFilter.empty.clearSearchAndFilters', 'Clear search and filters')
    : t('ui.advancedFilter.empty.clearAll', 'Clear all filters')
  const handlePrimary = searchActive
    ? () => { onClearSearch?.(); onClearAll() }
    : onClearAll
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12" data-testid="filtered-empty-results">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <SearchX className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="text-base font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground max-w-md text-center">{description}</div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" onClick={handlePrimary}>{primaryLabel}</Button>
        <Button type="button" variant="outline" disabled={!canRemoveLast} onClick={onRemoveLast}>
          <Undo2 className="size-4" />
          {t('ui.advancedFilter.empty.removeLast', 'Remove last filter')}
        </Button>
      </div>
    </div>
  )
}
