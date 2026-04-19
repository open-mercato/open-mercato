"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Link2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { LinkEntityDialog, type LinkEntityAdapter, type LinkEntityOption } from '../linking/LinkEntityDialog'

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
  searchEntities: (
    query: string,
    page: number,
  ) => Promise<{ items: LinkedEntityOption[]; totalPages: number }>
  fetchEntitiesByIds: (ids: string[]) => Promise<LinkedEntityOption[]>
  icon: React.ReactNode
}

const PAGE_SIZE = 20

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
  const selectedIdsKey = React.useMemo(() => selectedIds.join('|'), [selectedIds])

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
    setPage(1)
  }, [pageSearch])

  const filteredLinkedItems = React.useMemo(
    () => applyFilter(linkedItems, pageSearch),
    [linkedItems, pageSearch],
  )
  const totalPages = Math.max(1, Math.ceil(filteredLinkedItems.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedLinkedItems = React.useMemo(
    () =>
      filteredLinkedItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [currentPage, filteredLinkedItems],
  )
  const visibleLinkedItems = useRemoteLinkedList ? remoteLinkedItems : pagedLinkedItems
  const visiblePage = useRemoteLinkedList ? page : currentPage
  const visibleTotalPages = useRemoteLinkedList ? remoteLinkedTotalPages : totalPages
  const totalLinkedCount = linkedCount ?? linkedItems.length

  const adapter = React.useMemo<LinkEntityAdapter>(
    () => ({
      kind: 'person',
      dialogTitle: t(
        'customers.deals.detail.linkedEntities.dialogTitleShort',
        'Link {{entity}}',
        { entity: entityLabel.toLowerCase() },
      ),
      dialogSubtitle: t(
        'customers.deals.detail.linkedEntities.dialogSubtitle',
        'Link an existing {{entity}} to this deal',
        { entity: entityLabel.toLowerCase() },
      ),
      sectionLabel: t(
        'customers.deals.detail.linkedEntities.sectionLabel',
        'MATCHING {{entity}}',
        { entity: entityLabelPlural.toUpperCase() },
      ),
      searchPlaceholder: t(
        'customers.deals.detail.linkedEntities.searchAll',
        'Search all {{entity}}…',
        { entity: entityLabelPlural.toLowerCase() },
      ),
      searchEmptyHint: t(
        'customers.deals.detail.linkedEntities.noResults',
        'No matching records found.',
      ),
      selectedEmptyHint: t(
        'customers.deals.detail.linkedEntities.noneSelected',
        'No linked records selected.',
      ),
      confirmButtonLabel: t(
        'customers.deals.detail.linkedEntities.confirmButton',
        'Link {{entity}}',
        { entity: entityLabel.toLowerCase() },
      ),
      defaultAvatarIcon: icon,
      searchPage: async (query, searchPageIndex) => {
        const result = await searchEntities(query, searchPageIndex)
        return {
          items: result.items.map((item) => ({
            id: item.id,
            label: item.label,
            subtitle: item.subtitle ?? null,
          })),
          totalPages: result.totalPages,
        }
      },
      fetchByIds: async (ids) => {
        const result = await fetchEntitiesByIds(ids)
        return result.map((item) => ({
          id: item.id,
          label: item.label,
          subtitle: item.subtitle ?? null,
        }))
      },
    }),
    [entityLabel, entityLabelPlural, fetchEntitiesByIds, icon, searchEntities, t],
  )

  const handleDialogConfirm = React.useCallback(
    async ({
      nextSelectedIds,
    }: {
      addedIds: string[]
      removedIds: string[]
      nextSelectedIds: string[]
      optionsById: Record<string, LinkEntityOption>
    }) => {
      await onSaveSelection(nextSelectedIds)
      if (useRemoteLinkedList) {
        await refreshRemoteLinkedList({ showLoading: false })
      }
    },
    [onSaveSelection, refreshRemoteLinkedList, useRemoteLinkedList],
  )

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 rounded-[16px] border border-border/70 bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-foreground">{manageLabel}</div>
            <div className="text-sm text-muted-foreground">
              {t(
                'customers.deals.detail.linkedEntities.summary',
                '{{count}} linked {{entity}}',
                {
                  count: totalLinkedCount,
                  entity:
                    totalLinkedCount === 1
                      ? entityLabel.toLowerCase()
                      : entityLabelPlural.toLowerCase(),
                },
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:w-[260px]">
              <Input
                value={pageSearch}
                onChange={(event) => setPageSearch(event.target.value)}
                placeholder={searchPlaceholder}
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
                  <div className="truncate text-sm font-semibold text-foreground">
                    {item.label}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.subtitle || '—'}
                  </div>
                </div>
              </Link>
            ))}
            <Pagination
              page={visiblePage}
              totalPages={visibleTotalPages}
              onPageChange={setPage}
            />
          </div>
        ) : remoteLinkedLoading ? (
          <div className="rounded-[10px] border border-border bg-muted/20 px-5 py-5 text-sm text-muted-foreground">
            {t('customers.deals.detail.linkedEntities.loading', 'Loading linked records…')}
          </div>
        ) : (
          <div className="rounded-[10px] border border-border bg-muted/20 px-5 py-5 text-sm text-muted-foreground">
            {pageSearch.trim().length
              ? t(
                  'customers.deals.detail.linkedEntities.noSearchMatches',
                  'No linked records match the current search.',
                )
              : t('customers.deals.detail.linkedEntities.empty', 'No linked records yet.')}
          </div>
        )}
      </div>

      <LinkEntityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        adapter={adapter}
        initialSelectedIds={selectedIds}
        onConfirm={handleDialogConfirm}
      />
    </>
  )
}

export default DealLinkedEntitiesTab
