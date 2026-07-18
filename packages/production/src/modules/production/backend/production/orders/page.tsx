'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { ColumnDef } from '@tanstack/react-table'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { OrderStatusBadge, type OrderStatus } from '../components/OrderStatusBadge'

type OrderRow = {
  id: string
  number: number
  productId: string
  variantId: string | null
  qtyPlanned: string
  uom: string
  dueDate: string | null
  priority: number
  status: OrderStatus
  sourceType: 'sales_order' | 'mrp' | 'manual'
  sourceId: string | null
  qtyCompleted: string
  qtyScrapped: string
  updatedAt: string
}

type ResponsePayload = {
  items: OrderRow[]
  total: number
  page: number
  totalPages: number
}

const ORDER_STATUSES: OrderStatus[] = [
  'draft',
  'planned',
  'released',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
]

const SOURCE_TYPES: Array<'sales_order' | 'mrp' | 'manual'> = ['sales_order', 'mrp', 'manual']

/**
 * Production orders list (task 3.4) — DataTable with multi-select status
 * filter + source-type filter, matching `boms`/`routings` list conventions
 * (search + filter overlay + `router.push` navigation to create/detail).
 */
export default function ProductionOrdersPage() {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<OrderRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: '20' })
        if (search) params.set('search', search)
        const statusFilter = filters.status
        if (Array.isArray(statusFilter) && statusFilter.length > 0) {
          params.set('status', statusFilter.join(','))
        } else if (typeof statusFilter === 'string' && statusFilter) {
          params.set('status', statusFilter)
        }
        if (filters.sourceType) params.set('sourceType', String(filters.sourceType))

        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(`/api/production/orders?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          if (!cancelled) flash(t('production.orders.error.fetch_failed', 'Failed to load production orders'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch {
        if (!cancelled) flash(t('production.orders.error.fetch_failed', 'Failed to load production orders'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [page, search, filters, reloadToken, scopeVersion, t])

  const columns = React.useMemo<ColumnDef<OrderRow>[]>(
    () => [
      {
        id: 'number',
        accessorKey: 'number',
        header: t('production.orders.field.number', 'Number'),
        cell: ({ row }) => <span className="font-medium">{row.original.number}</span>,
      },
      { id: 'productId', accessorKey: 'productId', header: t('production.orders.field.product_id', 'Product') },
      {
        id: 'qtyPlanned',
        accessorKey: 'qtyPlanned',
        header: t('production.orders.field.qty', 'Qty (planned / completed)'),
        enableSorting: false,
        cell: ({ row }) => `${row.original.qtyPlanned} / ${row.original.qtyCompleted}`,
      },
      { id: 'uom', accessorKey: 'uom', header: t('production.orders.field.uom', 'UoM') },
      {
        id: 'status',
        accessorKey: 'status',
        header: t('production.orders.field.status', 'Status'),
        enableSorting: false,
        cell: ({ row }) => <OrderStatusBadge status={row.original.status} t={t} />,
      },
      {
        id: 'dueDate',
        accessorKey: 'dueDate',
        header: t('production.orders.field.due_date', 'Due date'),
        cell: ({ row }) => (row.original.dueDate ? new Date(row.original.dueDate).toLocaleDateString() : '—'),
      },
      { id: 'priority', accessorKey: 'priority', header: t('production.orders.field.priority', 'Priority') },
      {
        id: 'sourceType',
        accessorKey: 'sourceType',
        header: t('production.orders.field.source_type', 'Source'),
        enableSorting: false,
        cell: ({ row }) => t(`production.orders.source_type.${row.original.sourceType}`, row.original.sourceType),
      },
    ],
    [t],
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('production.orders.filters.status', 'Status'),
        type: 'select',
        multiple: true,
        options: ORDER_STATUSES.map((status) => ({
          value: status,
          label: t(`production.orders.status.${status}`, status),
        })),
      },
      {
        id: 'sourceType',
        label: t('production.orders.filters.source_type', 'Source'),
        type: 'select',
        options: [
          { label: t('production.orders.filters.all', 'All'), value: '' },
          ...SOURCE_TYPES.map((sourceType) => ({
            value: sourceType,
            label: t(`production.orders.source_type.${sourceType}`, sourceType),
          })),
        ],
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable<OrderRow>
          title={t('production.orders.title', 'Production Orders')}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('production.orders.search.placeholder', 'Search production orders...')}
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
            <Button onClick={() => router.push('/backend/production/orders/create')}>
              <Plus className="mr-2 h-4 w-4" />
              {t('production.orders.action.create', 'New production order')}
            </Button>
          }
          onRowClick={(row) => router.push(`/backend/production/orders/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'view', label: t('production.orders.action.view', 'View'), href: `/backend/production/orders/${row.id}` },
              ]}
            />
          )}
          emptyState={(
            <ListEmptyState
              entityName={t('production.orders.title', 'Production Orders')}
              createHref="/backend/production/orders/create"
              createLabel={t('production.orders.action.create', 'New production order')}
            />
          )}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
