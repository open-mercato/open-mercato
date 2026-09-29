"use client"

import * as React from 'react'
import { Search } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DocumentEntityType } from '../../../lib/entityRegistry'
import { sanitizeDocumentsDisplayLabel } from '../../../lib/displayLabels'
import { EntityPickerResults } from './EntityPickerResults'
import { useEntitySearch, type EntitySearchItem } from './useEntitySearch'

export type EntityPickerSelection = {
  type: DocumentEntityType
  id: string
  label: string
  href: string
  values: Record<string, string | null>
}
export type EntityPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (pick: EntityPickerSelection) => void
  typeFilter?: DocumentEntityType[]
  excludeId?: string
}

export function EntityPicker({ open, onOpenChange, onPick, typeFilter, excludeId }: EntityPickerProps) {
  const t = useT()
  const inputId = `documents-entity-picker-${React.useId()}`
  const listId = `${inputId}-results`
  const search = useEntitySearch(open, typeFilter, excludeId)

  const selectItem = React.useCallback((item: EntitySearchItem) => {
    if (!search.activeEntry || !search.isResultCurrent()) return
    const href = search.activeEntry.resolveHref(item)
    const label = sanitizeDocumentsDisplayLabel(item.label)
    if (!href || !label) return
    const rawItem = item.rawItem ?? {}
    const values = Object.fromEntries(search.activeEntry.tokenFields.map((field) => [
      field.field,
      sanitizeDocumentsDisplayLabel(field.extract(rawItem)),
    ]))
    onPick({ type: search.activeEntry.type, id: item.id, label, href, values })
    onOpenChange(false)
  }, [onOpenChange, onPick, search.activeEntry, search.isResultCurrent])

  const pickActiveItem = React.useCallback(() => {
    const item = search.items[search.activeIndex]
    if (item) selectItem(item)
  }, [search.activeIndex, search.items, selectItem])

  const handleSearchKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && search.items.length === 0) {
      event.preventDefault()
      search.setActiveIndex(-1)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      search.setActiveIndex((index) => Math.min(index + 1, search.items.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      search.setActiveIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      pickActiveItem()
    }
  }, [pickActiveItem, search.items.length, search.setActiveIndex])

  if (!open) return null
  const hasQuery = search.searchValue.trim().length > 0
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" onKeyDown={(event) => {
        if (event.defaultPrevented) return
        if (event.key === 'Escape') { event.preventDefault(); onOpenChange(false); return }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); pickActiveItem(); return }
      }}>
        <DialogHeader>
          <DialogTitle>{t('documents.entityPicker.title')}</DialogTitle>
          <DialogDescription>{t('documents.entityPicker.description')}</DialogDescription>
        </DialogHeader>
        {!search.isRegistryReady ? (
          <div role="status" aria-live="polite">
            <LoadingMessage label={t('documents.entityPicker.loadingRegistry')} />
          </div>
        ) : search.availableEntries.length > 0 ? (
          <div className="space-y-4">
            <SegmentedControl
              value={search.activeEntry?.type}
              onValueChange={(value) => {
                const entry = search.availableEntries.find((candidate) => candidate.type === value)
                if (!entry) return
                search.setActiveType(entry.type)
                search.setActiveIndex(-1)
              }}
              aria-label={t('documents.entityPicker.typeTabs')}
              className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl p-1 sm:grid-cols-4"
            >
              {search.availableEntries.map((entry) => (
                <SegmentedControlItem
                  key={entry.type}
                  value={entry.type}
                  className="h-auto min-h-7 min-w-0 whitespace-normal px-2 py-1 text-center leading-tight"
                >
                  {t(entry.labelKey)}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            <div className="space-y-2">
              <Label htmlFor={inputId}>{t('documents.entityPicker.searchLabel')}</Label>
              <Input
                id={inputId}
                value={search.searchValue}
                onChange={(event) => search.setSearchValue(event.target.value)}
                placeholder={t('documents.entityPicker.searchPlaceholder')}
                leftIcon={<Search />}
                role="combobox"
                aria-expanded={hasQuery}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={search.activeIndex >= 0 && search.activeIndex < search.items.length ? `${listId}-option-${search.activeIndex}` : undefined}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
            <EntityPickerResults
              listId={listId}
              items={search.items}
              activeIndex={search.activeIndex}
              hasQuery={hasQuery}
              isLoading={search.isLoading}
              hasSearched={search.hasSearched}
              hasError={search.hasError}
              prompt={t('documents.entityPicker.prompt')}
              loadingLabel={t('documents.entityPicker.loading')}
              emptyLabel={t('documents.entityPicker.noMatches')}
              errorLabel={t('documents.entityPicker.error.search')}
              retryLabel={t('documents.actions.retry')}
              onRetry={search.retry}
              onActiveIndexChange={search.setActiveIndex}
              onSelect={selectItem}
            />
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
            {t(search.allEntries.length === 0 ? 'documents.entityPicker.empty' : 'documents.entityPicker.unavailable')}
          </div>
        )}
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('documents.actions.cancel')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default EntityPicker
