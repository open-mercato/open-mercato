'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Tag, type TagMap } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus, GripVertical } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
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
import { OrphanBanner } from '../../components/OrphanBanner'

type CustomerGroupRow = {
  id: string
  organization_id: string | null
  tenant_id: string | null
  code: string
  name: string
  description: string | null
  kind: string
  parent_id: string | null
  priority: number
  is_default: boolean
  is_active: boolean
  created_at: string | null
  updated_at: string | null
}

type ResponsePayload = {
  items: CustomerGroupRow[]
  total: number
  page: number
  totalPages: number
}

const kindTagMap: TagMap<string> = {
  b2c: 'info',
  b2b: 'success',
  internal: 'neutral',
  partner: 'brand',
}

const activeStatusMap: StatusMap<'active' | 'inactive'> = {
  active: 'success',
  inactive: 'neutral',
}

// Drag handle for one row's priority cell. Mirrors the `SortableColumnItem`
// pattern in `packages/ui/src/backend/columns/ColumnChooserPanel.tsx` — the only
// other place in this repo wiring `@dnd-kit/core` + `@dnd-kit/sortable`.
//
// Known limitation: `DataTable`'s `TableRow` (packages/ui/src/primitives/table.tsx)
// is a plain function component that does not forward `ref`, so `useSortable`'s
// `setNodeRef` cannot be attached to the actual `<tr>` — only to this handle. The
// drag therefore animates the handle icon, not the whole row, while the
// underlying reorder math (collision detection, `arrayMove`) is fully correct
// because the handles stack in the same vertical order as the rows. A full
// row-lift animation would require `TableRow` to forward `ref`, which is a
// DataTable/Table primitive contract change gated behind "Ask First" in
// packages/ui/AGENTS.md.
function DragHandle({ id }: { id: string }) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <span
      ref={setNodeRef}
      style={style}
      className="inline-flex cursor-grab items-center text-muted-foreground active:cursor-grabbing"
      aria-label={t('customer_groups.groups.list.dragHandle', 'Reorder')}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" />
    </span>
  )
}

export default function CustomerGroupsPage() {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<CustomerGroupRow[]>([])
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const mutationContextId = 'customer-groups-list:mutation'
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
      try {
        const params = new URLSearchParams()
        params.set('page', '1')
        params.set('pageSize', '100')
        // Always requested explicitly: drag-reorder relies on the displayed
        // order matching `CustomerGroup.priority` ascending.
        params.set('sortField', 'priority')
        params.set('sortDir', 'asc')
        if (search) params.set('search', search)
        if (filters.isActive === 'true') params.set('isActive', 'true')
        if (filters.isActive === 'false') params.set('isActive', 'false')

        const fallback: ResponsePayload = { items: [], total: 0, page: 1, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(
          `/api/customer-groups?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          flash(t('customer_groups.groups.list.error.load', 'Failed to load customer groups'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
        }
      } catch {
        if (!cancelled) flash(t('customer_groups.groups.list.error.load', 'Failed to load customer groups'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [search, filters, reloadToken, t])

  // Drag-reorder only makes sense over the full, priority-ordered set: a search
  // term or an is_active filter narrows the visible rows to a subset, and
  // rewriting priorities for just that subset (in gaps of 10, per the reorder
  // command) would scramble the relative order of rows currently hidden by the
  // filter. Reordering stays available only on the unfiltered view.
  const dragReorderEnabled = !search && (!filters.isActive || filters.isActive === '')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = React.useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = rows.findIndex((row) => row.id === active.id)
      const newIndex = rows.findIndex((row) => row.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const previousRows = rows
      const reordered = [...rows]
      const [moved] = reordered.splice(oldIndex, 1)
      reordered.splice(newIndex, 0, moved)
      // Optimistic reorder — visible immediately, no page reload.
      setRows(reordered)

      try {
        const call = await apiCall('/api/customer-groups/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: reordered.map((row) => row.id) }),
        })
        if (!call.ok) {
          throw Object.assign(new Error('[internal] customer_groups.reorder failed'), { status: call.status })
        }
        flash(t('customer_groups.groups.list.flash.reordered', 'Group order updated'), 'success')
        setReloadToken((token) => token + 1)
      } catch {
        // Revert the optimistic reorder on failure.
        setRows(previousRows)
        flash(t('customer_groups.groups.list.flash.reorderError', 'Could not save the new order'), 'error')
      }
    },
    [rows, t],
  )

  const handleDelete = React.useCallback(
    async (row: CustomerGroupRow) => {
      const confirmed = await confirmDialog({
        title: t('customer_groups.groups.list.confirmDelete', 'Delete customer group "{code}"?', { code: row.code }),
        variant: 'destructive',
      })
      if (!confirmed) return

      try {
        await runMutation({
          operation: async () => {
            const call = await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(row.updated_at),
              () => apiCall(`/api/customer-groups?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }),
            )
            if (!call.ok) {
              throw Object.assign(new Error('[internal] customer_groups.delete failed'), {
                status: call.status,
                ...((call.result as Record<string, unknown> | null) ?? {}),
              })
            }
            return call
          },
          context: {
            formId: mutationContextId,
            resourceKind: 'customer_groups.group',
            resourceId: row.id,
            retryLastMutation,
          },
          mutationPayload: { id: row.id },
        })
        flash(t('customer_groups.groups.list.flash.deleted', 'Customer group deleted'), 'success')
        setReloadToken((token) => token + 1)
      } catch (error) {
        if (surfaceRecordConflict(error, t, { onRefresh: () => setReloadToken((token) => token + 1) })) return
        flash(t('customer_groups.groups.list.flash.deleteError', 'Could not delete the customer group'), 'error')
      }
    },
    [t, confirmDialog, mutationContextId, retryLastMutation, runMutation],
  )

  const columns = React.useMemo<ColumnDef<CustomerGroupRow>[]>(
    () => [
      {
        accessorKey: 'priority',
        header: t('customer_groups.groups.list.columns.priority', 'Priority'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {dragReorderEnabled ? (
              <DragHandle id={row.original.id} />
            ) : (
              <GripVertical className="size-4 text-muted-foreground/40" aria-hidden="true" />
            )}
            <span className="tabular-nums text-muted-foreground">{row.original.priority}</span>
          </div>
        ),
      },
      {
        accessorKey: 'code',
        header: t('customer_groups.groups.list.columns.code', 'Code'),
        cell: ({ row }) => <span className="font-mono font-medium">{row.original.code}</span>,
      },
      {
        accessorKey: 'name',
        header: t('customer_groups.groups.list.columns.name', 'Name'),
      },
      {
        accessorKey: 'kind',
        header: t('customer_groups.groups.list.columns.kind', 'Kind'),
        cell: ({ row }) => (
          <Tag variant={kindTagMap[row.original.kind] ?? 'default'} dot>
            {t(`customer_groups.groups.kind.${row.original.kind}`, row.original.kind)}
          </Tag>
        ),
      },
      {
        accessorKey: 'is_default',
        header: t('customer_groups.groups.list.columns.isDefault', 'Default'),
        cell: ({ row }) =>
          row.original.is_default ? (
            <Tag variant="brand" dot>
              {t('customer_groups.groups.list.defaultTag', 'Default')}
            </Tag>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'is_active',
        header: t('customer_groups.groups.list.columns.isActive', 'Status'),
        cell: ({ row }) => (
          <StatusBadge variant={activeStatusMap[row.original.is_active ? 'active' : 'inactive']} dot>
            {row.original.is_active
              ? t('customer_groups.groups.list.status.active', 'Active')
              : t('customer_groups.groups.list.status.inactive', 'Inactive')}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'updated_at',
        header: t('customer_groups.groups.list.columns.updatedAt', 'Updated'),
        cell: ({ row }) => (row.original.updated_at ? new Date(row.original.updated_at).toLocaleString() : '—'),
      },
    ],
    [t, dragReorderEnabled],
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'isActive',
        label: t('customer_groups.groups.list.filters.status', 'Status'),
        type: 'select',
        options: [
          { label: t('customer_groups.groups.list.filters.all', 'All'), value: '' },
          { label: t('customer_groups.groups.list.filters.active', 'Active'), value: 'true' },
          { label: t('customer_groups.groups.list.filters.inactive', 'Inactive'), value: 'false' },
        ],
      },
    ],
    [t],
  )

  const table = (
    <DataTable
      title={t('customer_groups.groups.list.title', 'Customer groups')}
      titleHeadingLevel={1}
      columns={columns}
      data={rows}
      sortable={false}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={t('customer_groups.groups.list.searchPlaceholder', 'Search groups...')}
      filters={filterDefs}
      filterValues={filters}
      onFiltersApply={setFilters}
      onFiltersClear={() => setFilters({})}
      actions={
        <Button asChild>
          <Link href="/backend/customer-groups/create">
            <Plus className="mr-2 h-4 w-4" />
            {t('customer_groups.groups.list.actions.create', 'Create group')}
          </Link>
        </Button>
      }
      rowActions={(row) => (
        <RowActions
          items={[
            { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/customer-groups/${row.id}/edit` },
            { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => handleDelete(row) },
          ]}
        />
      )}
      emptyState={
        <ListEmptyState
          entityName={t('customer_groups.groups.list.title', 'Customer groups')}
          title={t('customer_groups.groups.list.empty.title', 'No customer groups yet')}
          description={t(
            'customer_groups.groups.list.empty.description',
            'Create your first group to start organizing customers.',
          )}
          createHref="/backend/customer-groups/create"
          createLabel={t('customer_groups.groups.list.empty.createLabel', 'Create your first group')}
        />
      }
      isLoading={isLoading}
    />
  )

  return (
    <Page>
      <PageBody>
        <OrphanBanner />
        {dragReorderEnabled ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
              {table}
            </SortableContext>
          </DndContext>
        ) : (
          table
        )}
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
