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
import { Plus } from 'lucide-react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { EudrCommodity } from '../../../data/validators'
import { commodityOptions, type ProductSnapshot } from '../../../components/formConfig'

type ProductMappingRow = {
  id: string
  productId: string
  productSnapshot: ProductSnapshot | null
  commodity: EudrCommodity
  hsCode: string | null
  isInScope: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
}

type ProductMappingsResponse = {
  items: ProductMappingRow[]
  total: number
  totalPages: number
}

function formatDateTime(value: string | null | undefined, emptyLabel: string): string {
  if (!value) return emptyLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return emptyLabel
  return date.toLocaleString()
}

function formatProduct(row: ProductMappingRow): string {
  const name = typeof row.productSnapshot?.name === 'string' && row.productSnapshot.name.trim().length
    ? row.productSnapshot.name.trim()
    : null
  const sku = typeof row.productSnapshot?.sku === 'string' && row.productSnapshot.sku.trim().length
    ? row.productSnapshot.sku.trim()
    : null
  if (name && sku) return `${name} (${sku})`
  return name ?? sku ?? row.productId
}

export default function EudrProductMappingsPage() {
  const translate = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<ProductMappingRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const mutationContextId = 'eudr-product-mappings-list:delete'
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
    if (filters.isInScope === 'true' || filters.isInScope === 'false') {
      params.set('isInScope', filters.isInScope)
    }
    const firstSort = sorting[0]
    if (firstSort) {
      params.set('sortField', firstSort.id)
      params.set('sortDir', firstSort.desc ? 'desc' : 'asc')
    }
    return params.toString()
  }, [filters.commodity, filters.isInScope, page, pageSize, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function loadRows() {
      setLoading(true)
      try {
        const fallback: ProductMappingsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<ProductMappingsResponse>(
          `/api/eudr/product-mappings?${queryParams}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          flash(translate('eudr.productMappings.list.loadError'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (cancelled) return
        setRows(Array.isArray(payload.items) ? payload.items : [])
        setTotal(typeof payload.total === 'number' ? payload.total : 0)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch {
        if (!cancelled) flash(translate('eudr.productMappings.list.loadError'), 'error')
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

  const handleDelete = React.useCallback(async (row: ProductMappingRow) => {
    const confirmed = await confirm({
      title: translate('eudr.productMappings.list.confirmDelete', { product: formatProduct(row) }),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt),
            () => apiCall(
              `/api/eudr/product-mappings?id=${encodeURIComponent(row.id)}`,
              { method: 'DELETE' },
            ),
          )
          if (!call.ok) {
            throw Object.assign(new Error('[internal] eudr product mapping delete failed'), {
              status: call.status,
              ...((call.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return call
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'eudr.product_mapping',
          resourceId: row.id,
          retryLastMutation,
        },
        mutationPayload: { id: row.id },
      })
      flash(translate('eudr.productMappings.list.deleteSuccess'), 'success')
      refreshRows()
    } catch (error) {
      if (surfaceRecordConflict(error, translate, { onRefresh: refreshRows })) return
      flash(translate('eudr.productMappings.list.deleteError'), 'error')
    }
  }, [confirm, mutationContextId, refreshRows, retryLastMutation, runMutation, translate])

  const columns = React.useMemo<ColumnDef<ProductMappingRow>[]>(() => [
    {
      accessorKey: 'productId',
      header: translate('eudr.productMappings.list.columns.product'),
      cell: ({ row }) => (
        <Link href={`/backend/eudr/product-mappings/${row.original.id}`} className="font-medium hover:underline">
          {formatProduct(row.original)}
        </Link>
      ),
      meta: { maxWidth: '260px', truncate: true },
    },
    {
      accessorKey: 'commodity',
      header: translate('eudr.productMappings.list.columns.commodity'),
      cell: ({ row }) => translate(`eudr.commodity.${row.original.commodity}`),
    },
    {
      accessorKey: 'hsCode',
      header: translate('eudr.productMappings.list.columns.hsCode'),
      cell: ({ row }) => row.original.hsCode || translate('eudr.common.empty'),
    },
    {
      accessorKey: 'isInScope',
      header: translate('eudr.productMappings.list.columns.isInScope'),
      cell: ({ row }) => row.original.isInScope ? translate('eudr.common.yes') : translate('eudr.common.no'),
    },
    {
      accessorKey: 'updatedAt',
      header: translate('eudr.productMappings.list.columns.updatedAt'),
      cell: ({ row }) => formatDateTime(row.original.updatedAt, translate('eudr.common.empty')),
    },
  ], [translate])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'commodity',
      label: translate('eudr.productMappings.list.filters.commodity'),
      type: 'select',
      options: [
        { value: '', label: translate('eudr.productMappings.list.filters.allCommodities') },
        ...commodityOptions(translate),
      ],
    },
    {
      id: 'isInScope',
      label: translate('eudr.productMappings.list.filters.scope'),
      type: 'select',
      options: [
        { value: '', label: translate('eudr.productMappings.list.filters.allScopes') },
        { value: 'true', label: translate('eudr.productMappings.list.filters.inScope') },
        { value: 'false', label: translate('eudr.productMappings.list.filters.outOfScope') },
      ],
    },
  ], [translate])

  return (
    <Page>
      <PageBody>
        <DataTable<ProductMappingRow>
          title={translate('eudr.productMappings.list.title')}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(nextSearch) => {
            setSearch(nextSearch)
            setPage(1)
          }}
          searchPlaceholder={translate('eudr.productMappings.list.searchPlaceholder')}
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
              <Link href="/backend/eudr/product-mappings/create">
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                {translate('eudr.productMappings.list.actions.create')}
              </Link>
            </Button>
          )}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: translate('eudr.productMappings.list.actions.edit'),
                  href: `/backend/eudr/product-mappings/${row.id}`,
                },
                {
                  id: 'delete',
                  label: translate('eudr.productMappings.list.actions.delete'),
                  destructive: true,
                  onSelect: () => {
                    void handleDelete(row)
                  },
                },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/eudr/product-mappings/${row.id}`)}
          rowClickActionIds={['edit']}
          emptyState={(
            <ListEmptyState
              entityName={translate('eudr.productMappings.list.entityName')}
              createHref="/backend/eudr/product-mappings/create"
              createLabel={translate('eudr.productMappings.list.actions.create')}
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
          perspective={{ tableId: 'eudr.product_mappings.list' }}
          stickyActionsColumn
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
