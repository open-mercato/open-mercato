'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { ColumnDef } from '@tanstack/react-table'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { WorkCenterKind } from '../../../data/entities.js'

type WorkCenterRow = {
  id: string
  name: string
  kind: WorkCenterKind
  costRatePerHour: string
  parallelStations: number
  efficiencyFactor: string
  isActive: boolean
  updatedAt: string
}

type ResponsePayload = {
  items: WorkCenterRow[]
  total: number
  page: number
  totalPages: number
}

export default function WorkCentersPage() {
  const t = useT()
  const router = useRouter()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<WorkCenterRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const mutationContextId = 'production-work-centers-list:mutation'
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
        const params = new URLSearchParams({ page: String(page), pageSize: '20' })
        if (search) params.set('search', search)
        if (filters.kind) params.set('kind', String(filters.kind))
        if (filters.isActive === 'true') params.set('isActive', 'true')
        if (filters.isActive === 'false') params.set('isActive', 'false')

        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(
          `/api/production/work-centers?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          if (!cancelled) flash(t('production.work_centers.error.fetch_failed', 'Failed to load work centers'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch {
        if (!cancelled) flash(t('production.work_centers.error.fetch_failed', 'Failed to load work centers'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [page, search, filters, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(
    async (row: WorkCenterRow) => {
      const confirmed = await confirmDialog({
        title: t('production.work_centers.confirm.delete', 'Are you sure you want to delete this work center?'),
        variant: 'destructive',
      })
      if (!confirmed) return

      try {
        await runMutation({
          operation: async () => {
            const call = await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(row.updatedAt),
              () => apiCall('/api/production/work-centers', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: row.id }),
              }),
            )
            if (!call.ok) {
              throw Object.assign(new Error('[internal] production.work_centers.delete failed'), {
                status: call.status,
                ...((call.result as Record<string, unknown> | null) ?? {}),
              })
            }
            return call
          },
          context: {
            formId: mutationContextId,
            resourceKind: 'production.work_center',
            resourceId: row.id,
            retryLastMutation,
          },
          mutationPayload: { id: row.id },
        })

        flash(t('production.work_centers.success.deleted', 'Work center deleted successfully'), 'success')
        setReloadToken((tok) => tok + 1)
      } catch (error) {
        if (surfaceRecordConflict(error, t, { onRefresh: () => setReloadToken((tok) => tok + 1) })) return
        flash(t('production.work_centers.error.delete_failed', 'Failed to delete work center'), 'error')
      }
    },
    [t, confirmDialog, mutationContextId, retryLastMutation, runMutation],
  )

  const columns = React.useMemo<ColumnDef<WorkCenterRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: t('production.work_centers.field.name', 'Name'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: 'kind',
        accessorKey: 'kind',
        header: t('production.work_centers.field.kind', 'Kind'),
        cell: ({ row }) => (
          <span>{t(`production.work_centers.kind.${row.original.kind}`, row.original.kind)}</span>
        ),
      },
      {
        id: 'costRatePerHour',
        accessorKey: 'costRatePerHour',
        header: t('production.work_centers.field.cost_rate_per_hour', 'Cost rate / hour'),
      },
      {
        id: 'isActive',
        accessorKey: 'isActive',
        header: t('production.work_centers.field.is_active', 'Active'),
        enableSorting: false,
        cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
      },
    ],
    [t],
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'kind',
        label: t('production.work_centers.filters.kind', 'Kind'),
        type: 'select',
        options: [
          { label: t('production.work_centers.filters.all', 'All'), value: '' },
          { label: t('production.work_centers.kind.machine', 'Machine'), value: 'machine' },
          { label: t('production.work_centers.kind.manual', 'Manual'), value: 'manual' },
          { label: t('production.work_centers.kind.line', 'Line'), value: 'line' },
          { label: t('production.work_centers.kind.subcontractor', 'Subcontractor'), value: 'subcontractor' },
        ],
      },
      {
        id: 'isActive',
        label: t('production.work_centers.filters.status', 'Status'),
        type: 'select',
        options: [
          { label: t('production.work_centers.filters.all', 'All'), value: '' },
          { label: t('production.work_centers.field.is_active', 'Active'), value: 'true' },
          { label: t('production.work_centers.field.is_active', 'Active'), value: 'false' },
        ],
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable<WorkCenterRow>
          title={t('production.work_centers.title', 'Work Centers')}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('production.work_centers.search.placeholder', 'Search work centers...')}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(values) => {
            setFilters(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilters({})
            setPage(1)
          }}
          actions={
            <Button onClick={() => router.push('/backend/production/work-centers/create')}>
              <Plus className="mr-2 h-4 w-4" />
              {t('production.work_centers.action.create', 'New work center')}
            </Button>
          }
          onRowClick={(row) => router.push(`/backend/production/work-centers/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('production.work_centers.action.edit', 'Edit'),
                  href: `/backend/production/work-centers/${row.id}`,
                },
                {
                  id: 'delete',
                  label: t('production.work_centers.action.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => handleDelete(row),
                },
              ]}
            />
          )}
          emptyState={(
            <ListEmptyState
              entityName={t('production.work_centers.title', 'Work Centers')}
              createHref="/backend/production/work-centers/create"
              createLabel={t('production.work_centers.action.create', 'New work center')}
            />
          )}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
