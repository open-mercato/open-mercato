"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Plus } from 'lucide-react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { EudrCommodity, EudrStatementStatus } from '../../../data/validators'
import { commodityOptions, statementStatusOptions, statusBadgeVariant } from '../../../components/formConfig'

type StatementRow = {
  id: string
  title: string
  commodity: EudrCommodity
  referenceNumber: string | null
  verificationNumber: string | null
  status: EudrStatementStatus
  quantityKg: number | string | null
  orderId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

type StatementsResponse = {
  items: StatementRow[]
  total: number
  totalPages: number
}

function formatDateTime(value: string | null | undefined, emptyLabel: string): string {
  if (!value) return emptyLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return emptyLabel
  return date.toLocaleString()
}

function formatQuantityKg(value: number | string | null, emptyLabel: string): string {
  if (value === null || value === undefined) return emptyLabel
  if (typeof value === 'string' && !value.trim()) return emptyLabel
  return String(value)
}

export default function EudrStatementsPage() {
  const translate = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<StatementRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const mutationContextId = 'eudr-statements-list:delete'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: translate('ui.forms.flash.saveBlocked'),
  })

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (search.trim()) params.set('search', search.trim())
    if (typeof filters.commodity === 'string' && filters.commodity.trim()) {
      params.set('commodity', filters.commodity.trim())
    }
    if (typeof filters.status === 'string' && filters.status.trim()) {
      params.set('status', filters.status.trim())
    }
    const firstSort = sorting[0]
    if (firstSort) {
      params.set('sortField', firstSort.id)
      params.set('sortDir', firstSort.desc ? 'desc' : 'asc')
    }
    return params.toString()
  }, [filters.commodity, filters.status, page, pageSize, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function loadRows() {
      setLoading(true)
      try {
        const fallback: StatementsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<StatementsResponse>(
          `/api/eudr/statements?${queryParams}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          flash(translate('eudr.statements.list.loadError'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (cancelled) return
        setRows(Array.isArray(payload.items) ? payload.items : [])
        setTotal(typeof payload.total === 'number' ? payload.total : 0)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch {
        if (!cancelled) flash(translate('eudr.statements.list.loadError'), 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRows()
    return () => {
      cancelled = true
    }
  }, [queryParams, reloadToken, scopeVersion, translate])

  const refreshRows = React.useCallback(() => {
    setReloadToken((currentToken) => currentToken + 1)
  }, [])

  const handleDelete = React.useCallback(async (row: StatementRow) => {
    const confirmed = await confirm({
      title: translate('eudr.statements.list.confirmDelete', { title: row.title }),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt),
            () => apiCall(
              `/api/eudr/statements?id=${encodeURIComponent(row.id)}`,
              { method: 'DELETE' },
            ),
          )
          if (!call.ok) {
            throw Object.assign(new Error('[internal] eudr statement delete failed'), {
              status: call.status,
              ...((call.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return call
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'eudr.due_diligence_statement',
          resourceId: row.id,
          retryLastMutation,
        },
        mutationPayload: { id: row.id },
      })
      flash(translate('eudr.statements.list.deleteSuccess'), 'success')
      refreshRows()
    } catch (error) {
      if (surfaceRecordConflict(error, translate, { onRefresh: refreshRows })) return
      flash(translate('eudr.statements.list.deleteError'), 'error')
    }
  }, [confirm, mutationContextId, refreshRows, retryLastMutation, runMutation, translate])

  const columns = React.useMemo<ColumnDef<StatementRow>[]>(() => [
    {
      accessorKey: 'title',
      header: translate('eudr.statements.list.columns.title'),
      cell: ({ row }) => (
        <Link href={`/backend/eudr/statements/${row.original.id}`} className="font-medium hover:underline">
          {row.original.title}
        </Link>
      ),
      meta: { maxWidth: '260px', truncate: true },
    },
    {
      accessorKey: 'commodity',
      header: translate('eudr.statements.list.columns.commodity'),
      cell: ({ row }) => translate(`eudr.commodity.${row.original.commodity}`),
    },
    {
      accessorKey: 'status',
      header: translate('eudr.statements.list.columns.status'),
      cell: ({ row }) => (
        <StatusBadge variant={statusBadgeVariant(row.original.status)} dot>
          {translate(`eudr.statementStatus.${row.original.status}`)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'referenceNumber',
      header: translate('eudr.statements.list.columns.referenceNumber'),
      cell: ({ row }) => row.original.referenceNumber || translate('eudr.common.empty'),
    },
    {
      accessorKey: 'quantityKg',
      header: translate('eudr.statements.list.columns.quantityKg'),
      cell: ({ row }) => formatQuantityKg(row.original.quantityKg, translate('eudr.common.empty')),
    },
    {
      accessorKey: 'updatedAt',
      header: translate('eudr.statements.list.columns.updatedAt'),
      cell: ({ row }) => formatDateTime(row.original.updatedAt, translate('eudr.common.empty')),
    },
  ], [translate])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'commodity',
      label: translate('eudr.statements.list.filters.commodity'),
      type: 'select',
      options: [
        { value: '', label: translate('eudr.statements.list.filters.allCommodities') },
        ...commodityOptions(translate),
      ],
    },
    {
      id: 'status',
      label: translate('eudr.statements.list.filters.status'),
      type: 'select',
      options: [
        { value: '', label: translate('eudr.statements.list.filters.allStatuses') },
        ...statementStatusOptions(translate),
      ],
    },
  ], [translate])

  return (
    <Page>
      <PageBody>
        <DataTable<StatementRow>
          title={translate('eudr.statements.list.title')}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(nextSearch) => {
            setSearch(nextSearch)
            setPage(1)
          }}
          searchPlaceholder={translate('eudr.statements.list.searchPlaceholder')}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(nextFilters) => {
            setFilters(nextFilters)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilters({})
            setPage(1)
          }}
          actions={(
            <Button asChild>
              <Link href="/backend/eudr/statements/create">
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                {translate('eudr.statements.list.actions.create')}
              </Link>
            </Button>
          )}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: translate('eudr.statements.list.actions.edit'),
                  href: `/backend/eudr/statements/${row.id}`,
                },
                {
                  id: 'delete',
                  label: translate('eudr.statements.list.actions.delete'),
                  destructive: true,
                  onSelect: () => {
                    void handleDelete(row)
                  },
                },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/eudr/statements/${row.id}`)}
          rowClickActionIds={['edit']}
          emptyState={(
            <ListEmptyState
              entityName={translate('eudr.statements.list.entityName')}
              createHref="/backend/eudr/statements/create"
              createLabel={translate('eudr.statements.list.actions.create')}
            />
          )}
          sortable
          manualSorting
          sorting={sorting}
          onSortingChange={(nextSorting) => {
            setSorting(nextSorting)
            setPage(1)
          }}
          pagination={{
            page,
            pageSize,
            total,
            totalPages,
            onPageChange: setPage,
            pageSizeOptions: [20, 50, 100],
            onPageSizeChange: (nextPageSize) => {
              setPageSize(nextPageSize)
              setPage(1)
            },
          }}
          isLoading={loading}
          perspective={{ tableId: 'eudr.statements.list' }}
          stickyActionsColumn
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
