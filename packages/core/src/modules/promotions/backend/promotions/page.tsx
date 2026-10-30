'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, GripVertical, Plus } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Card, CardContent } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const PAGE_SIZE = 50
const RESOURCE_KIND = 'promotions.promotion'

type PromotionRow = {
  id: string
  name: string
  description: string | null
  order: number
  active: boolean
  startsAt: string | null
  endsAt: string | null
  cumulative: boolean
  tags: string[]
  excludedTags: string[]
  updatedAt: string | null
}

type ListResponse = {
  items: PromotionRow[]
  total: number
  page: number
  totalPages: number
  totalIsCapped?: boolean
}

type OrderPatchResponse = {
  updated: string[]
  conflicts: { id: string; currentUpdatedAt: string }[]
}

// Whether the current working copy's id sequence differs from the server's —
// the cheapest correct test for "has the display order changed" since both
// arrays always carry the same ids (no row is added/removed locally).
function sameOrder(a: PromotionRow[], b: PromotionRow[]): boolean {
  if (a.length !== b.length) return false
  return a.every((row, index) => row.id === b[index]?.id)
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString()
}

function isFilterValueActive(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.values(value).some((entry) => entry != null && entry !== '')
  return value !== ''
}

type PromotionCardProps = {
  row: PromotionRow
  canDrag: boolean
  canEdit: boolean
  canDelete: boolean
  isFirst: boolean
  isLast: boolean
  onToggleActive: (checked: boolean) => void
  onToggleCumulative: (checked: boolean) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}

// One promotion card. `useSortable` is always called (dnd-kit requires a
// stable hook per rendered id) but drag is inert via `disabled` when the
// caller lacks `promotions.update` — the handle and up/down buttons are also
// hidden in that case, matching the DataTable-row precedent in
// `customer_groups/backend/customer-groups/page.tsx`.
function PromotionCard({
  row,
  canDrag,
  canEdit,
  canDelete,
  isFirst,
  isLast,
  onToggleActive,
  onToggleCumulative,
  onMoveUp,
  onMoveDown,
  onDelete,
}: PromotionCardProps) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !canDrag,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const startsLabel = formatDate(row.startsAt)
  const endsLabel = formatDate(row.endsAt)
  const windowLabel = startsLabel || endsLabel
    ? [
        startsLabel ? t('promotions.list.card.starts', 'Starts {date}', { date: startsLabel }) : null,
        endsLabel ? t('promotions.list.card.ends', 'Ends {date}', { date: endsLabel }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : t('promotions.list.card.noWindow', 'No date restriction')

  return (
    <div ref={setNodeRef} style={style}>
      <Card className={isDragging ? 'border-primary shadow-lg' : undefined}>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            {canDrag ? (
              <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
                <span
                  className="inline-flex cursor-grab items-center text-muted-foreground active:cursor-grabbing"
                  aria-label={t('promotions.list.card.dragHandle', 'Reorder')}
                  {...attributes}
                  {...listeners}
                >
                  <GripVertical className="size-4" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={t('promotions.list.card.moveUp', 'Move up')}
                    disabled={isFirst}
                    onClick={onMoveUp}
                  >
                    <ArrowUp className="size-3.5" />
                  </IconButton>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={t('promotions.list.card.moveDown', 'Move down')}
                    disabled={isLast}
                    onClick={onMoveDown}
                  >
                    <ArrowDown className="size-3.5" />
                  </IconButton>
                </div>
              </div>
            ) : null}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{row.name}</span>
                <span className="text-xs text-muted-foreground">{windowLabel}</span>
              </div>
              {row.description ? (
                <p className="truncate text-xs text-muted-foreground">{row.description}</p>
              ) : null}
              {row.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {row.tags.map((tag) => (
                    <Tag key={tag} variant="neutral">
                      {tag}
                    </Tag>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={row.active} onCheckedChange={onToggleActive} disabled={!canEdit} />
                {t('promotions.list.card.active', 'Active')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={row.cumulative} onCheckedChange={onToggleCumulative} disabled={!canEdit} />
                {t('promotions.list.card.cumulative', 'Cumulative')}
              </label>
            </div>
            <div className="flex items-center gap-2">
              {canEdit ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/backend/promotions/${row.id}`}>{t('promotions.list.card.edit', 'Edit')}</Link>
                </Button>
              ) : null}
              {canDelete ? (
                <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
                  {t('promotions.list.card.delete', 'Delete')}
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function PromotionsListPage() {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const canCreate = chromeReady && hasFeature(chromePayload?.grantedFeatures, 'promotions.create')
  const canUpdate = chromeReady && hasFeature(chromePayload?.grantedFeatures, 'promotions.update')
  const canDelete = chromeReady && hasFeature(chromePayload?.grantedFeatures, 'promotions.delete')

  const [rows, setRows] = React.useState<PromotionRow[]>([])
  const [serverRows, setServerRows] = React.useState<PromotionRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  const mutationContextId = 'promotions-list:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', String(PAGE_SIZE))
        // Drag-sort and the Up/Down buttons both rely on the displayed order
        // matching `Promotion.order` ascending.
        params.set('sortField', 'order')
        params.set('sortDir', 'asc')
        if (search) params.set('search', search)
        if (filterValues.active === 'true' || filterValues.active === 'false') {
          params.set('active', filterValues.active)
        }
        if (filterValues.cumulative === 'true' || filterValues.cumulative === 'false') {
          params.set('cumulative', filterValues.cumulative)
        }
        const dateRange = filterValues.startsWindow as { from?: string; to?: string } | undefined
        if (dateRange?.from) params.set('startsFrom', dateRange.from)
        if (dateRange?.to) params.set('startsTo', dateRange.to)
        const tagList = Array.isArray(filterValues.tags)
          ? filterValues.tags.filter((entry: unknown): entry is string => typeof entry === 'string')
          : []
        if (tagList.length) params.set('tags', tagList.join(','))

        const fallback: ListResponse = { items: [], total: 0, page: 1, totalPages: 1 }
        const call = await apiCall<ListResponse>(`/api/promotions?${params.toString()}`, undefined, { fallback })
        if (cancelled) return
        if (!call.ok) {
          setRows([])
          setServerRows([])
          setLoadError(t('promotions.list.errors.loadFailed', 'Failed to load promotions'))
          return
        }
        const payload = call.result ?? fallback
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items)
        setServerRows(items)
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' && payload.totalPages > 0 ? payload.totalPages : 1)
        setTotalIsCapped(payload.totalIsCapped === true)
      } catch {
        if (!cancelled) {
          setRows([])
          setServerRows([])
          setLoadError(t('promotions.list.errors.loadFailed', 'Failed to load promotions'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [page, search, filterValues, reloadToken, t])

  const handleSearchChange = React.useCallback((next: string) => {
    setSearch(next)
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((next: FilterValues) => {
    setFilterValues(next)
    setPage(1)
  }, [])

  const isFiltered = Boolean(search) || Object.values(filterValues).some(isFilterValueActive)
  const orderDirty = !sameOrder(rows, serverRows)
  const toggleDirty = rows.some((row) => {
    const server = serverRows.find((candidate) => candidate.id === row.id)
    return server ? server.active !== row.active || server.cumulative !== row.cumulative : false
  })
  const isDirty = orderDirty || toggleDirty
  // The reorder command writes an absolute `order` per item (§API Contracts),
  // and the admin only ever sees the current filtered/paginated page, so
  // saving while filtered or across more than one page can only touch the
  // slots the visible rows already occupy — promotions outside this view keep
  // their own `order` but may end up interleaved differently. The banner
  // names that risk explicitly rather than silently pretending the reorder is
  // scoped to the full dataset.
  const showFilterWarning = isDirty && (isFiltered || totalPages > 1)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const moveRow = React.useCallback((id: string, direction: -1 | 1) => {
    setRows((current) => {
      const index = current.findIndex((row) => row.id === id)
      if (index === -1) return current
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }, [])

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setRows((current) => {
      const oldIndex = current.findIndex((row) => row.id === active.id)
      const newIndex = current.findIndex((row) => row.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return current
      const next = [...current]
      const [moved] = next.splice(oldIndex, 1)
      next.splice(newIndex, 0, moved)
      return next
    })
  }, [])

  const handleToggleActive = React.useCallback((id: string, checked: boolean) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, active: checked } : row)))
  }, [])

  const handleToggleCumulative = React.useCallback((id: string, checked: boolean) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, cumulative: checked } : row)))
  }, [])

  const handleDelete = React.useCallback(
    async (row: PromotionRow) => {
      // The list response (Step 1.5, `GET /api/promotions`) does not carry a
      // rule-count or "tree is non-empty" flag, so there is no honest way to
      // show the confirmation only for promotions with a populated tree as
      // the spec describes. Confirming unconditionally is the safe default —
      // flagged in the Step 1.6 report as a possible Step 1.5 follow-up
      // (adding e.g. `ruleNodeCount` to the list projection).
      const confirmed = await confirmDialog({
        title: t('promotions.list.confirmDelete.title', 'Delete promotion "{name}"?', { name: row.name }),
        description: t(
          'promotions.list.confirmDelete.description',
          'This permanently removes the promotion and its rule tree. This cannot be undone.',
        ),
        variant: 'destructive',
      })
      if (!confirmed) return

      try {
        await runMutation({
          operation: async () => {
            const call = await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(row.updatedAt),
              () => apiCall(`/api/promotions?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }),
            )
            if (!call.ok) {
              throw Object.assign(new Error('[internal] promotions.delete failed'), {
                status: call.status,
                ...((call.result as Record<string, unknown> | null) ?? {}),
              })
            }
            return call
          },
          context: {
            formId: mutationContextId,
            resourceKind: RESOURCE_KIND,
            resourceId: row.id,
            retryLastMutation,
          },
          mutationPayload: { id: row.id },
        })
        flash(t('promotions.list.flash.deleted', 'Promotion deleted'), 'success')
        setReloadToken((v) => v + 1)
      } catch (error) {
        if (surfaceRecordConflict(error, t, { onRefresh: () => setReloadToken((v) => v + 1) })) return
        const serverMessage = (error as { error?: unknown } | null)?.error
        flash(
          typeof serverMessage === 'string' && serverMessage.trim()
            ? serverMessage
            : t('promotions.list.flash.deleteError', 'Could not delete the promotion'),
          'error',
        )
      }
    },
    [t, confirmDialog, mutationContextId, retryLastMutation, runMutation],
  )

  const handleSave = React.useCallback(async () => {
    if (!isDirty) return
    setIsSaving(true)
    const conflictIds = new Set<string>()
    try {
      await runMutation({
        operation: async () => {
          if (orderDirty) {
            // Redistribute the visible rows' own existing `order` slots across
            // their new positions — this keeps promotions outside the current
            // filtered/paginated view untouched (their `order` values are
            // never read here), at the cost of the interleaving risk the
            // filter/pagination warning banner names.
            const orderedSlots = rows.map((row) => row.order).sort((left, right) => left - right)
            const items = rows
              .map((row, index) => ({ id: row.id, order: orderedSlots[index], updatedAt: row.updatedAt }))
              .filter((item): item is { id: string; order: number; updatedAt: string } => typeof item.updatedAt === 'string')
            if (items.length) {
              const call = await apiCall<OrderPatchResponse>('/api/promotions/order', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items }),
              })
              if (!call.ok) {
                throw Object.assign(new Error('[internal] promotions.order save failed'), { status: call.status })
              }
              for (const conflict of call.result?.conflicts ?? []) conflictIds.add(conflict.id)
            }
          }

          // Toggle PUTs run after the reorder PATCH and lock against the
          // pre-save `updatedAt`. A promotion that was BOTH dragged and
          // toggled in this same Save will therefore see its own just-written
          // reorder as a conflict here — surfaced through the same per-item
          // conflict path as a genuine concurrent edit, resolved by pressing
          // Save again (the reload below refreshes `updatedAt` first).
          const dirtyToggleRows = rows.filter((row) => {
            const server = serverRows.find((candidate) => candidate.id === row.id)
            return server ? server.active !== row.active || server.cumulative !== row.cumulative : false
          })
          for (const row of dirtyToggleRows) {
            const server = serverRows.find((candidate) => candidate.id === row.id)
            try {
              await withScopedApiRequestHeaders(
                buildOptimisticLockHeader(server?.updatedAt ?? null),
                () =>
                  apiCallOrThrow('/api/promotions', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: row.id, active: row.active, cumulative: row.cumulative }),
                  }),
              )
            } catch (err) {
              if (extractOptimisticLockConflict(err)) {
                conflictIds.add(row.id)
                continue
              }
              throw err
            }
          }
        },
        context: {
          formId: mutationContextId,
          resourceKind: RESOURCE_KIND,
          resourceId: 'save',
          retryLastMutation,
        },
        mutationPayload: { ids: rows.map((row) => row.id) },
      })

      if (conflictIds.size > 0) {
        flash(
          t(
            'promotions.list.flash.saveConflicts',
            '{count} change(s) could not be saved because the promotion changed elsewhere. Showing current data.',
            { count: String(conflictIds.size) },
          ),
          'error',
        )
      } else {
        flash(t('promotions.list.flash.saved', 'Promotions updated'), 'success')
      }
    } catch {
      flash(t('promotions.list.flash.saveError', 'Could not save promotion changes'), 'error')
    } finally {
      setIsSaving(false)
      setReloadToken((v) => v + 1)
    }
  }, [isDirty, orderDirty, rows, serverRows, runMutation, mutationContextId, retryLastMutation, t])

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'active',
        label: t('promotions.list.filters.status', 'Status'),
        type: 'select',
        options: [
          { value: '', label: t('promotions.list.filters.status.all', 'All') },
          { value: 'true', label: t('promotions.list.filters.status.active', 'Active') },
          { value: 'false', label: t('promotions.list.filters.status.inactive', 'Inactive') },
        ],
      },
      {
        id: 'cumulative',
        label: t('promotions.list.filters.cumulative', 'Cumulative'),
        type: 'select',
        options: [
          { value: '', label: t('promotions.list.filters.cumulative.all', 'All') },
          { value: 'true', label: t('promotions.list.filters.cumulative.yes', 'Cumulative') },
          { value: 'false', label: t('promotions.list.filters.cumulative.no', 'Non-cumulative') },
        ],
      },
      {
        id: 'startsWindow',
        label: t('promotions.list.filters.dateRange', 'Date range'),
        type: 'dateRange',
      },
      {
        id: 'tags',
        label: t('promotions.list.filters.tags', 'Tags'),
        type: 'tags',
        placeholder: t('promotions.list.filters.tagsPlaceholder', 'Add a tag...'),
      },
    ],
    [t],
  )

  const hasRows = rows.length > 0

  return (
    <Page>
      <PageHeader
        title={t('promotions.list.title', 'Promotions')}
        description={t('promotions.list.description', 'Manage promotion rules, benefits, and display order.')}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/backend/promotions/create">
                <Plus className="mr-2 h-4 w-4" />
                {t('promotions.list.actions.create', 'Create promotion')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        <FilterBar
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('promotions.list.searchPlaceholder', 'Search promotions...')}
          filters={filterDefs}
          values={filterValues}
          onApply={handleFiltersApply}
          onClear={() => handleFiltersApply({})}
        />

        {isLoading ? <LoadingMessage label={t('promotions.list.loading', 'Loading promotions...')} /> : null}
        {!isLoading && loadError ? <ErrorMessage label={loadError} /> : null}

        {!isLoading && !loadError && !hasRows ? (
          <ListEmptyState
            entityName={t('promotions.list.title', 'Promotions')}
            title={t('promotions.list.empty.title', 'No promotions yet')}
            description={t(
              'promotions.list.empty.description',
              'Create your first promotion to start configuring rules and benefits.',
            )}
            createHref={canCreate ? '/backend/promotions/create' : undefined}
            createLabel={t('promotions.list.empty.createLabel', 'Create your first promotion')}
          />
        ) : null}

        {!isLoading && !loadError && hasRows ? (
          <>
            {showFilterWarning ? (
              <Alert status="warning" size="sm" className="mb-4">
                {t(
                  'promotions.list.save.filterWarning',
                  'Saving while filtered may reorder promotions outside the current page.',
                )}
              </Alert>
            ) : null}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {rows.map((row, index) => (
                    <PromotionCard
                      key={row.id}
                      row={row}
                      canDrag={canUpdate}
                      canEdit={canUpdate}
                      canDelete={canDelete}
                      isFirst={index === 0}
                      isLast={index === rows.length - 1}
                      onToggleActive={(checked) => handleToggleActive(row.id, checked)}
                      onToggleCumulative={(checked) => handleToggleCumulative(row.id, checked)}
                      onMoveUp={() => moveRow(row.id, -1)}
                      onMoveDown={() => moveRow(row.id, 1)}
                      onDelete={() => handleDelete(row)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <Pagination
              className="mt-4"
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              totalIsCapped={totalIsCapped}
              onPageChange={setPage}
              showPageSize={false}
            />
          </>
        ) : null}

        {canUpdate ? (
          <div
            className={`sticky bottom-0 z-sticky mt-4 flex items-center justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur ${
              isDirty ? 'border-accent' : 'border-border'
            }`}
          >
            <span className="text-xs text-muted-foreground">
              {isDirty
                ? t('promotions.list.save.unsavedHint', 'Unsaved changes')
                : t('promotions.list.save.allSaved', 'All changes saved')}
            </span>
            <Button
              type="button"
              size="sm"
              className={isDirty ? 'border-2 border-accent' : undefined}
              disabled={!isDirty || isSaving}
              onClick={handleSave}
            >
              {isSaving ? <Spinner className="size-4" /> : null}
              {t('promotions.list.save.button', 'Save')}
            </Button>
          </div>
        ) : null}
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
