"use client"
import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Badge } from '@open-mercato/ui/primitives/badge'

type TransactionRow = {
  id: string
  linkName?: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  amount?: number | null
  currencyCode: string
  status: string
  paymentStatus?: string | null
  createdAt?: string | null
}

type TransactionsResponse = {
  items: TransactionRow[]
  total: number
  totalPages: number
  canViewPii?: boolean
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

function formatAmount(amount: number | null | undefined, currencyCode: string): string {
  const resolved = typeof amount === 'number' ? amount : 0
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(resolved)
  } catch {
    return `${resolved.toFixed(2)} ${currencyCode}`
  }
}

export default function CheckoutTransactionsPage() {
  const [rows, setRows] = React.useState<TransactionRow[]>([])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [canViewPii, setCanViewPii] = React.useState(false)

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'pending', label: 'Pending' },
        { value: 'processing', label: 'Processing' },
        { value: 'completed', label: 'Completed' },
        { value: 'failed', label: 'Failed' },
        { value: 'cancelled', label: 'Cancelled' },
        { value: 'expired', label: 'Expired' },
      ],
    },
  ], [])

  const loadRows = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '25',
      search,
    })
    if (typeof filters.status === 'string' && filters.status) params.set('status', filters.status)
    if (typeof filters.linkId === 'string' && filters.linkId) params.set('linkId', filters.linkId)
    const result = await readApiResultOrThrow<TransactionsResponse>(`/api/checkout/transactions?${params.toString()}`)
    setRows(result.items ?? [])
    setTotal(result.total ?? 0)
    setTotalPages(result.totalPages ?? 1)
    setCanViewPii(result.canViewPii === true)
    setLoading(false)
  }, [filters.linkId, filters.status, page, search])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<TransactionRow>[]>(() => {
    const baseColumns: ColumnDef<TransactionRow>[] = [
      { accessorKey: 'linkName', header: 'Link' },
    ]
    if (canViewPii) {
      baseColumns.push(
        {
          id: 'customer',
          header: 'Customer',
          cell: ({ row }) => [row.original.firstName, row.original.lastName].filter(Boolean).join(' ') || '—',
        },
        {
          accessorKey: 'email',
          header: 'Email',
          cell: ({ row }) => row.original.email ?? '—',
        },
      )
    }
    baseColumns.push(
      {
        accessorKey: 'amount',
        header: 'Amount',
        cell: ({ row }) => formatAmount(row.original.amount, row.original.currencyCode),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
      },
      {
        accessorKey: 'paymentStatus',
        header: 'Pay. status',
        cell: ({ row }) => row.original.paymentStatus ?? '—',
      },
      {
        accessorKey: 'createdAt',
        header: 'Date',
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
    )
    return baseColumns
  }, [canViewPii])

  return (
    <Page>
      <PageBody>
        <DataTable
          title="Transactions"
          columns={columns}
          data={rows}
          isLoading={loading}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder="Search transactions…"
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(next) => { setFilters(next); setPage(1) }}
          onFiltersClear={() => { setFilters({}); setPage(1) }}
          pagination={{ page, pageSize: 25, total, totalPages, onPageChange: setPage }}
          perspective={{ tableId: 'checkout-transactions' }}
          rowActions={(row) => <RowActions items={[{ id: 'view', label: 'View detail', href: `/backend/checkout/transactions/${encodeURIComponent(row.id)}` }]} />}
        />
      </PageBody>
    </Page>
  )
}
