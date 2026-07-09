"use client"

import * as React from 'react'
import { Search } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
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
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  DOCUMENT_ENTITY_REGISTRY,
  readItemsArray,
  type DocumentEntityType,
  type EntityPickerItem,
  type EntityRegistryEntry,
} from '../../../lib/entityRegistry'

export type EntityPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (pick: { type: DocumentEntityType; id: string; label: string; href: string }) => void
  typeFilter?: DocumentEntityType[]
}

const PAGE_SIZE = 20
const DEBOUNCE_MS = 250

function buildSearchUrl(entry: EntityRegistryEntry, query: string): string {
  const params = new URLSearchParams({
    search: query,
    page: '1',
    pageSize: String(PAGE_SIZE),
  })
  return `${entry.searchPath}?${params.toString()}`
}

function filterEntries(typeFilter: DocumentEntityType[] | undefined): EntityRegistryEntry[] {
  if (!typeFilter) return DOCUMENT_ENTITY_REGISTRY
  if (typeFilter.length === 0) return []
  const allowedTypes = new Set(typeFilter)
  return DOCUMENT_ENTITY_REGISTRY.filter((entry) => allowedTypes.has(entry.type))
}

export function EntityPicker({ open, onOpenChange, onPick, typeFilter }: EntityPickerProps) {
  const t = useT()
  const generatedId = React.useId()
  const inputId = `documents-entity-picker-${generatedId}`
  const listId = `${inputId}-results`
  const typeFilterKey = typeFilter?.join('|') ?? ''
  const requestSequenceRef = React.useRef(0)

  const allEntries = React.useMemo(() => filterEntries(typeFilter), [typeFilterKey])
  const [unavailableTypes, setUnavailableTypes] = React.useState<Set<DocumentEntityType>>(() => new Set())
  const availableEntries = React.useMemo(
    () => allEntries.filter((entry) => !unavailableTypes.has(entry.type)),
    [allEntries, unavailableTypes],
  )

  const [activeType, setActiveType] = React.useState<DocumentEntityType | null>(allEntries[0]?.type ?? null)
  const [searchValue, setSearchValue] = React.useState('')
  const [items, setItems] = React.useState<EntityPickerItem[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(-1)

  const activeEntry = React.useMemo(
    () => availableEntries.find((entry) => entry.type === activeType) ?? availableEntries[0] ?? null,
    [activeType, availableEntries],
  )

  React.useEffect(() => {
    if (!open) {
      requestSequenceRef.current += 1
      setIsLoading(false)
      return
    }
    setUnavailableTypes(new Set())
    setActiveType(allEntries[0]?.type ?? null)
    setSearchValue('')
    setItems([])
    setIsLoading(false)
    setHasSearched(false)
    setActiveIndex(-1)
  }, [allEntries, open])

  React.useEffect(() => {
    if (!open) return
    if (!activeEntry) {
      setActiveType(null)
      setItems([])
      setHasSearched(false)
      setActiveIndex(-1)
      return
    }
    if (activeType !== activeEntry.type) {
      setActiveType(activeEntry.type)
    }
  }, [activeEntry, activeType, open])

  const markUnavailable = React.useCallback((type: DocumentEntityType) => {
    requestSequenceRef.current += 1
    setUnavailableTypes((current) => {
      const next = new Set(current)
      next.add(type)
      return next
    })
    setItems([])
    setHasSearched(false)
    setActiveIndex(-1)
    setIsLoading(false)
  }, [])

  const fetchResults = React.useCallback(async (entry: EntityRegistryEntry, query: string) => {
    const requestId = requestSequenceRef.current + 1
    requestSequenceRef.current = requestId
    setIsLoading(true)
    setHasSearched(false)

    try {
      const call = await apiCall<unknown>(
        buildSearchUrl(entry, query),
        undefined,
        { fallback: { items: [] } },
      )
      if (requestSequenceRef.current !== requestId) return
      if (!call.ok) {
        markUnavailable(entry.type)
        return
      }

      const nextItems = readItemsArray(call.result)
        .map(entry.mapItem)
        .filter((item): item is EntityPickerItem => item !== null)
      setItems(nextItems)
      setHasSearched(true)
      setActiveIndex(nextItems.length > 0 ? 0 : -1)
    } catch {
      if (requestSequenceRef.current === requestId) {
        markUnavailable(entry.type)
      }
    } finally {
      if (requestSequenceRef.current === requestId) setIsLoading(false)
    }
  }, [markUnavailable])

  React.useEffect(() => {
    if (!open || !activeEntry) return
    const query = searchValue.trim()
    if (query.length < 1) {
      requestSequenceRef.current += 1
      setItems([])
      setIsLoading(false)
      setHasSearched(false)
      setActiveIndex(-1)
      return
    }

    const timer = window.setTimeout(() => {
      void fetchResults(activeEntry, query)
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [activeEntry, fetchResults, open, searchValue])

  const selectItem = React.useCallback((item: EntityPickerItem) => {
    if (!activeEntry) return
    onPick({
      type: activeEntry.type,
      id: item.id,
      label: item.label,
      href: activeEntry.href(item.id),
    })
    onOpenChange(false)
  }, [activeEntry, onOpenChange, onPick])

  const pickActiveItem = React.useCallback(() => {
    const item = items[activeIndex]
    if (item) selectItem(item)
  }, [activeIndex, items, selectItem])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onOpenChange(false)
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      pickActiveItem()
      return
    }
    if (items.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => Math.min(current + 1, items.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      pickActiveItem()
    }
  }, [items.length, onOpenChange, pickActiveItem])

  const searchHasValue = searchValue.trim().length > 0
  const emptyMessage =
    allEntries.length === 0
      ? t('documents.entityPicker.empty')
      : t('documents.entityPicker.unavailable')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('documents.entityPicker.title')}</DialogTitle>
          <DialogDescription>{t('documents.entityPicker.description')}</DialogDescription>
        </DialogHeader>

        {availableEntries.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('documents.entityPicker.typeTabs')}>
              {availableEntries.map((entry) => (
                <Button
                  key={entry.type}
                  type="button"
                  size="sm"
                  variant={entry.type === activeEntry?.type ? 'secondary' : 'ghost'}
                  role="tab"
                  aria-selected={entry.type === activeEntry?.type}
                  onClick={() => {
                    setActiveType(entry.type)
                    setItems([])
                    setHasSearched(false)
                    setActiveIndex(-1)
                  }}
                >
                  {t(entry.labelKey)}
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor={inputId}>{t('documents.entityPicker.searchLabel')}</Label>
              <Input
                id={inputId}
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder={t('documents.entityPicker.searchPlaceholder')}
                leftIcon={<Search />}
                role="combobox"
                aria-expanded={searchHasValue}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
              />
            </div>

            <div
              id={listId}
              role="listbox"
              className="min-h-56 max-h-80 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground"
            >
              {!searchHasValue ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {t('documents.entityPicker.prompt')}
                </div>
              ) : isLoading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  <span>{t('documents.entityPicker.loading')}</span>
                </div>
              ) : hasSearched && items.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {t('documents.entityPicker.noMatches')}
                </div>
              ) : (
                <div className="space-y-1">
                  {items.map((item, index) => (
                    <Button
                      id={`${listId}-option-${index}`}
                      key={`${activeEntry?.type ?? 'entity'}:${item.id}`}
                      type="button"
                      variant="ghost"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={cn(
                        'h-auto w-full justify-start px-3 py-2 text-left',
                        index === activeIndex ? 'bg-accent text-accent-foreground' : null,
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectItem(item)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{item.label}</span>
                        {item.subtitle ? (
                          <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                        ) : null}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('documents.actions.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
