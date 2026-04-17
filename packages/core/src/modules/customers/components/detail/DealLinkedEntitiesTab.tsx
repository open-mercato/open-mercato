"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Check, Link2, Loader2, Search, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'

type LinkedEntityOption = {
  id: string
  label: string
  subtitle?: string | null
}

type DealLinkedEntitiesTabProps = {
  entityLabel: string
  entityLabelPlural: string
  manageLabel: string
  searchPlaceholder: string
  linkedItems: LinkedEntityOption[]
  linkedCount?: number
  selectedIds: string[]
  disabled?: boolean
  savePending?: boolean
  hrefBuilder: (id: string) => string
  onSaveSelection: (nextIds: string[]) => Promise<void> | void
  loadLinkedPage?: (
    page: number,
    query: string,
  ) => Promise<{ items: LinkedEntityOption[]; totalPages: number; total: number }>
  searchEntities: (query: string, page: number) => Promise<{ items: LinkedEntityOption[]; totalPages: number }>
  fetchEntitiesByIds: (ids: string[]) => Promise<LinkedEntityOption[]>
  icon: React.ReactNode
}

const PAGE_SIZE = 20
const DIALOG_SELECTED_PAGE_SIZE = 15

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function applyFilter(items: LinkedEntityOption[], query: string): LinkedEntityOption[] {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery.length) return items
  return items.filter((item) => {
    const label = normalizeText(item.label)
    const subtitle = normalizeText(item.subtitle ?? '')
    return label.includes(normalizedQuery) || subtitle.includes(normalizedQuery)
  })
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function mergeEntityOptions(items: LinkedEntityOption[]): LinkedEntityOption[] {
  const merged = new Map<string, LinkedEntityOption>()
  items.forEach((item) => merged.set(item.id, item))
  return Array.from(merged.values())
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t border-border/70 pt-3 text-sm text-muted-foreground">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-[10px] px-3 text-xs"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-[10px] px-3 text-xs"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Next
          <ArrowRight className="ml-1.5 size-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function DealLinkedEntitiesTab({
  entityLabel,
  entityLabelPlural,
  manageLabel,
  searchPlaceholder,
  linkedItems,
  linkedCount,
  selectedIds,
  disabled = false,
  savePending = false,
  hrefBuilder,
  onSaveSelection,
  loadLinkedPage,
  searchEntities,
  fetchEntitiesByIds,
  icon,
}: DealLinkedEntitiesTabProps) {
  const t = useT()
  const useRemoteLinkedList = typeof loadLinkedPage === 'function'
  const [pageSearch, setPageSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [remoteLinkedItems, setRemoteLinkedItems] = React.useState<LinkedEntityOption[]>([])
  const [remoteLinkedTotalPages, setRemoteLinkedTotalPages] = React.useState(1)
  const [remoteLinkedLoading, setRemoteLinkedLoading] = React.useState(false)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogQuery, setDialogQuery] = React.useState('')
  const [dialogSearchPage, setDialogSearchPage] = React.useState(1)
  const [dialogSearchTotalPages, setDialogSearchTotalPages] = React.useState(1)
  const [dialogSelectedPage, setDialogSelectedPage] = React.useState(1)
  const [draftIds, setDraftIds] = React.useState<string[]>(selectedIds)
  const [draftSaving, setDraftSaving] = React.useState(false)
  const [dialogCache, setDialogCache] = React.useState<Map<string, LinkedEntityOption>>(() => new Map())
  const [searchResults, setSearchResults] = React.useState<LinkedEntityOption[]>([])
  const [searchLoading, setSearchLoading] = React.useState(false)
  const [searchLoadingMore, setSearchLoadingMore] = React.useState(false)
  const selectedIdsKey = React.useMemo(() => selectedIds.join('|'), [selectedIds])

  React.useEffect(() => {
    setDraftIds(selectedIds)
  }, [selectedIds])

  React.useEffect(() => {
    if (dialogOpen) return
    setDialogQuery('')
    setSearchResults([])
    setDialogSearchPage(1)
    setDialogSearchTotalPages(1)
    setDialogSelectedPage(1)
  }, [dialogOpen])

  React.useEffect(() => {
    setDialogCache((prev) => {
      const next = new Map(prev)
      linkedItems.forEach((item) => next.set(item.id, item))
      searchResults.forEach((item) => next.set(item.id, item))
      return next
    })
  }, [linkedItems, searchResults])

  React.useEffect(() => {
    if (!dialogOpen) return
    let cancelled = false
    const timeout = window.setTimeout(async () => {
      const appendRequest = dialogSearchPage > 1
      if (appendRequest) {
        setSearchLoadingMore(true)
      } else {
        setSearchLoading(true)
      }
      try {
        const result = await searchEntities(dialogQuery, dialogSearchPage)
        if (!cancelled) {
          setSearchResults((current) => {
            if (dialogSearchPage <= 1) return result.items
            return mergeEntityOptions([...current, ...result.items])
          })
          setDialogSearchTotalPages(result.totalPages)
        }
      } catch {
        if (!cancelled) {
          if (!appendRequest) {
            setSearchResults([])
            setDialogSearchTotalPages(1)
          }
        }
      } finally {
        if (!cancelled) {
          if (appendRequest) {
            setSearchLoadingMore(false)
          } else {
            setSearchLoading(false)
          }
        }
      }
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [dialogOpen, dialogQuery, dialogSearchPage, searchEntities])

  const filteredLinkedItems = React.useMemo(
    () => applyFilter(linkedItems, pageSearch),
    [linkedItems, pageSearch],
  )
  const totalPages = Math.max(1, Math.ceil(filteredLinkedItems.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedLinkedItems = React.useMemo(
    () => filteredLinkedItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [currentPage, filteredLinkedItems],
  )

  React.useEffect(() => {
    setPage(1)
  }, [pageSearch])

  const refreshRemoteLinkedList = React.useCallback(
    async (options?: { showLoading?: boolean }) => {
      if (!useRemoteLinkedList || !loadLinkedPage) return
      const showLoading = options?.showLoading ?? true
      if (showLoading) setRemoteLinkedLoading(true)
      try {
        const result = await loadLinkedPage(page, pageSearch)
        setRemoteLinkedItems(result.items)
        setRemoteLinkedTotalPages(result.totalPages)
      } catch {
        setRemoteLinkedItems([])
        setRemoteLinkedTotalPages(1)
      } finally {
        if (showLoading) setRemoteLinkedLoading(false)
      }
    },
    [loadLinkedPage, page, pageSearch, useRemoteLinkedList],
  )

  React.useEffect(() => {
    if (!useRemoteLinkedList || !loadLinkedPage) return
    void refreshRemoteLinkedList()
  }, [loadLinkedPage, refreshRemoteLinkedList, useRemoteLinkedList])

  React.useEffect(() => {
    if (!useRemoteLinkedList || dialogOpen) return
    void refreshRemoteLinkedList({ showLoading: false })
  }, [dialogOpen, refreshRemoteLinkedList, selectedIdsKey, useRemoteLinkedList])

  React.useEffect(() => {
    if (!dialogOpen) return
    setDialogSelectedPage(1)
  }, [dialogOpen, dialogQuery])

  React.useEffect(() => {
    if (!dialogOpen) return
    setDialogSearchPage(1)
  }, [dialogOpen, dialogQuery])

  const selectedOptions = React.useMemo(
    () => draftIds.map((id) => dialogCache.get(id) ?? { id, label: id, subtitle: null }),
    [dialogCache, draftIds],
  )
  const selectedDraftIdSet = React.useMemo(() => new Set(draftIds), [draftIds])
  const visibleLinkedItems = useRemoteLinkedList ? remoteLinkedItems : pagedLinkedItems
  const visiblePage = useRemoteLinkedList ? page : currentPage
  const visibleTotalPages = useRemoteLinkedList ? remoteLinkedTotalPages : totalPages
  const totalLinkedCount = linkedCount ?? linkedItems.length
  const selectedTotalPages = Math.max(1, Math.ceil(selectedOptions.length / DIALOG_SELECTED_PAGE_SIZE))
  const currentSelectedPage = Math.min(dialogSelectedPage, selectedTotalPages)
  const pagedSelectedOptions = React.useMemo(
    () =>
      selectedOptions.slice(
        (currentSelectedPage - 1) * DIALOG_SELECTED_PAGE_SIZE,
        currentSelectedPage * DIALOG_SELECTED_PAGE_SIZE,
      ),
    [currentSelectedPage, selectedOptions],
  )
  const visibleResultIds = React.useMemo(
    () => searchResults.map((result) => result.id),
    [searchResults],
  )
  const selectedVisibleCount = React.useMemo(
    () => visibleResultIds.filter((id) => selectedDraftIdSet.has(id)).length,
    [selectedDraftIdSet, visibleResultIds],
  )
  const selectableVisibleCount = visibleResultIds.length - selectedVisibleCount

  React.useEffect(() => {
    if (!dialogOpen) return
    const visibleMissingIds = pagedSelectedOptions
      .map((item) => item.id)
      .filter((id) => !dialogCache.has(id))
    if (!visibleMissingIds.length) return
    let cancelled = false
    void fetchEntitiesByIds(visibleMissingIds).then((entries) => {
      if (cancelled) return
      setDialogCache((prev) => {
        const next = new Map(prev)
        entries.forEach((entry) => next.set(entry.id, entry))
        return next
      })
    }).catch((err) => console.warn('[DealLinkedEntitiesTab] fetchEntitiesByIds failed', err))
    return () => {
      cancelled = true
    }
  }, [dialogCache, dialogOpen, fetchEntitiesByIds, pagedSelectedOptions])

  const toggleDraftId = React.useCallback((id: string, checked: boolean) => {
    setDraftIds((current) => {
      if (checked) {
        if (current.includes(id)) return current
        return [...current, id]
      }
      return current.filter((candidate) => candidate !== id)
    })
  }, [])

  const selectVisibleResults = React.useCallback(() => {
    if (!searchResults.length) return
    setDraftIds((current) => {
      const merged = new Set(current)
      searchResults.forEach((result) => merged.add(result.id))
      return Array.from(merged)
    })
  }, [searchResults])

  const clearVisibleResults = React.useCallback(() => {
    if (!searchResults.length) return
    const visibleIds = new Set(searchResults.map((result) => result.id))
    setDraftIds((current) => current.filter((id) => !visibleIds.has(id)))
  }, [searchResults])

  const handleDialogOpenChange = React.useCallback((nextOpen: boolean) => {
    setDialogOpen(nextOpen)
    if (!nextOpen) {
      setDraftIds(selectedIds)
      setDialogQuery('')
      setDialogSearchPage(1)
      setDialogSearchTotalPages(1)
      setSearchLoading(false)
      setSearchLoadingMore(false)
    }
  }, [selectedIds])

  const handleDialogSave = React.useCallback(async () => {
    if (draftSaving || sameIds(draftIds, selectedIds)) {
      setDialogOpen(false)
      return
    }
    setDraftSaving(true)
    try {
      await onSaveSelection(draftIds)
      if (useRemoteLinkedList) {
        await refreshRemoteLinkedList({ showLoading: false })
      }
      setDialogOpen(false)
    } finally {
      setDraftSaving(false)
    }
  }, [draftIds, draftSaving, onSaveSelection, refreshRemoteLinkedList, selectedIds, useRemoteLinkedList])

  const handleDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleDialogSave()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      handleDialogOpenChange(false)
    }
  }, [handleDialogOpenChange, handleDialogSave])

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 rounded-[16px] border border-border/70 bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-foreground">
              {manageLabel}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('customers.deals.detail.linkedEntities.summary', '{{count}} linked {{entity}}', {
                count: totalLinkedCount,
                entity: totalLinkedCount === 1 ? entityLabel.toLowerCase() : entityLabelPlural.toLowerCase(),
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={pageSearch}
                onChange={(event) => setPageSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-[10px] px-3"
              onClick={() => setDialogOpen(true)}
              disabled={disabled || savePending}
            >
              <Link2 className="mr-2 size-4" />
              {t('customers.deals.detail.linkedEntities.manage', 'Manage links')}
            </Button>
          </div>
        </div>

        {visibleLinkedItems.length ? (
          <div className="space-y-3">
            {visibleLinkedItems.map((item) => (
              <Link
                key={item.id}
                href={hrefBuilder(item.id)}
                className="flex items-start gap-3 rounded-[18px] border border-border/70 bg-card px-4 py-4 transition-colors hover:bg-accent"
              >
                <div className="mt-0.5 rounded-full bg-muted p-2 text-muted-foreground">
                  {icon}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{item.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.subtitle || '—'}</div>
                </div>
              </Link>
            ))}
            <Pagination page={visiblePage} totalPages={visibleTotalPages} onPageChange={setPage} />
          </div>
        ) : remoteLinkedLoading ? (
          <div className="rounded-[10px] border border-border bg-muted/20 px-5 py-5 text-sm text-muted-foreground">
            {t('customers.deals.detail.linkedEntities.loading', 'Loading linked records…')}
          </div>
        ) : (
          <div className="rounded-[10px] border border-border bg-muted/20 px-5 py-5 text-sm text-muted-foreground">
            {pageSearch.trim().length
              ? t('customers.deals.detail.linkedEntities.noSearchMatches', 'No linked records match the current search.')
              : t('customers.deals.detail.linkedEntities.empty', 'No linked records yet.')}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-4xl" onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>
              {t('customers.deals.detail.linkedEntities.dialogTitle', 'Manage linked {{entity}}', {
                entity: entityLabelPlural.toLowerCase(),
              })}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={dialogQuery}
                  onChange={(event) => setDialogQuery(event.target.value)}
                  placeholder={t('customers.deals.detail.linkedEntities.searchAll', 'Search all {{entity}}…', {
                    entity: entityLabelPlural.toLowerCase(),
                  })}
                  className="pl-9"
                  autoFocus
                />
              </div>

              <div className="rounded-[16px] border border-border/70 bg-card">
                <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                  <div className="text-sm font-semibold text-foreground">
                    {t('customers.deals.detail.linkedEntities.searchResults', 'Search results')}
                  </div>
                  {searchResults.length ? (
                    <div className="flex items-center gap-2">
                      {selectableVisibleCount > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-[8px] px-2 text-xs"
                          onClick={selectVisibleResults}
                        >
                          {t('customers.deals.detail.linkedEntities.selectVisible', 'Select visible')}
                        </Button>
                      ) : null}
                      {selectedVisibleCount > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-[8px] px-2 text-xs"
                          onClick={clearVisibleResults}
                        >
                          {t('customers.deals.detail.linkedEntities.clearVisible', 'Clear visible')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {searchLoading && searchResults.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      {t('customers.deals.detail.linkedEntities.searching', 'Searching…')}
                    </div>
                  ) : searchResults.length ? (
                    <>
                      {searchResults.map((result) => {
                        const checked = selectedDraftIdSet.has(result.id)
                        return (
                          <label
                            key={result.id}
                            className="flex cursor-pointer items-start gap-3 border-b border-border/50 px-4 py-3 last:border-b-0 hover:bg-accent/40"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => toggleDraftId(result.id, Boolean(value))}
                              className="mt-0.5"
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">{result.label}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">{result.subtitle || '—'}</div>
                            </div>
                          </label>
                        )
                      })}
                      {dialogSearchPage < dialogSearchTotalPages || searchLoadingMore ? (
                        <div className="border-t border-border/70 px-4 py-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => setDialogSearchPage((current) => current + 1)}
                            disabled={searchLoading || searchLoadingMore}
                          >
                            {searchLoadingMore ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                            {t('customers.deals.detail.linkedEntities.loadMore', 'Load more')}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      {t('customers.deals.detail.linkedEntities.noResults', 'No matching records found.')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-[16px] border border-border/70 bg-card">
                <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {t('customers.deals.detail.linkedEntities.selectedTitle', 'Selected {{entity}}', {
                        entity: entityLabelPlural.toLowerCase(),
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {draftIds.length} {draftIds.length === 1 ? entityLabel.toLowerCase() : entityLabelPlural.toLowerCase()}
                    </div>
                  </div>
                  {draftIds.length ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-[8px] px-2 text-xs"
                      onClick={() => setDraftIds([])}
                    >
                      <X className="mr-1.5 size-3.5" />
                      {t('customers.deals.detail.linkedEntities.clearAll', 'Clear')}
                    </Button>
                  ) : null}
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {pagedSelectedOptions.length ? (
                    pagedSelectedOptions.map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3 last:border-b-0">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{item.label}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{item.subtitle || '—'}</div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-[8px] px-2 text-xs"
                          onClick={() => toggleDraftId(item.id, false)}
                        >
                          <X className="mr-1.5 size-3.5" />
                          {t('customers.deals.detail.linkedEntities.remove', 'Remove')}
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      {t('customers.deals.detail.linkedEntities.noneSelected', 'No linked records selected.')}
                    </div>
                  )}
                </div>
              </div>
              <Pagination
                page={currentSelectedPage}
                totalPages={selectedTotalPages}
                onPageChange={setDialogSelectedPage}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleDialogOpenChange(false)} disabled={draftSaving}>
              {t('customers.deals.detail.actions.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => { void handleDialogSave() }} disabled={draftSaving || disabled}>
              {draftSaving ? (
                <>
                  <Check className="mr-2 size-4" />
                  {t('customers.deals.detail.linkedEntities.saving', 'Saving…')}
                </>
              ) : (
                t('customers.deals.detail.actions.apply', 'Apply')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
