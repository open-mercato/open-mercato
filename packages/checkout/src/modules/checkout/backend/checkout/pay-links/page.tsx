"use client"
import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type LinkRow = {
  id: string
  name: string
  slug: string
  pricingMode: 'fixed' | 'custom_amount' | 'price_list'
  fixedPriceAmount?: number | null
  fixedPriceCurrencyCode?: string | null
  customAmountMin?: number | null
  customAmountMax?: number | null
  customAmountCurrencyCode?: string | null
  isActive: boolean
  completionCount: number
  maxCompletions?: number | null
  createdAt?: string | null
}

type ListResponse = {
  items: LinkRow[]
  total: number
  totalPages: number
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

function formatPricing(row: LinkRow): string {
  if (row.pricingMode === 'fixed') {
    return `Fixed ${row.fixedPriceAmount?.toFixed(2) ?? '0.00'} ${row.fixedPriceCurrencyCode ?? ''}`.trim()
  }
  if (row.pricingMode === 'custom_amount') {
    return `Custom ${row.customAmountMin?.toFixed(2) ?? '0.00'}-${row.customAmountMax?.toFixed(2) ?? '0.00'} ${row.customAmountCurrencyCode ?? ''}`.trim()
  }
  return 'Price List'
}

export default function CheckoutPayLinksPage() {
  const [rows, setRows] = React.useState<LinkRow[]>([])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'isActive',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
    },
    {
      id: 'pricingMode',
      label: 'Pricing',
      type: 'select',
      options: [
        { value: 'fixed', label: 'Fixed' },
        { value: 'custom_amount', label: 'Custom amount' },
        { value: 'price_list', label: 'Price list' },
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
    if (typeof filters.isActive === 'string' && filters.isActive) params.set('isActive', filters.isActive)
    if (typeof filters.pricingMode === 'string' && filters.pricingMode) params.set('pricingMode', filters.pricingMode)
    const result = await readApiResultOrThrow<ListResponse>(`/api/checkout/links?${params.toString()}`)
    setRows(result.items ?? [])
    setTotal(result.total ?? 0)
    setTotalPages(result.totalPages ?? 1)
    setLoading(false)
  }, [filters.isActive, filters.pricingMode, page, search])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<LinkRow>[]>(() => [
    { accessorKey: 'name', header: 'Name' },
    {
      accessorKey: 'slug',
      header: 'Slug',
      cell: ({ row }) => <span className="font-mono text-xs">/pay/{row.original.slug}</span>,
    },
    {
      accessorKey: 'pricingMode',
      header: 'Pricing',
      cell: ({ row }) => formatPricing(row.original),
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
          {row.original.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      accessorKey: 'completionCount',
      header: 'Uses',
      cell: ({ row }) => `${row.original.completionCount} / ${row.original.maxCompletions ?? '∞'}`,
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
  ], [])

  return (
    <Page>
      <PageHeader title="Pay Links" description="Create and manage public payment links." />
      <PageBody>
        <DataTable
          title="Pay Links"
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder="Search pay links…"
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(next) => { setFilters(next); setPage(1) }}
          onFiltersClear={() => { setFilters({}); setPage(1) }}
          pagination={{ page, pageSize: 25, total, totalPages, onPageChange: setPage }}
          isLoading={loading}
          perspective={{ tableId: 'checkout-links' }}
          actions={<Button asChild><Link href="/backend/checkout/pay-links/create">Create Link</Link></Button>}
          rowActions={(row) => (
            <RowActions items={[
              { id: 'edit', label: 'Edit', href: `/backend/checkout/pay-links/${encodeURIComponent(row.id)}` },
              { id: 'view', label: 'View Pay Page', href: `/pay/${encodeURIComponent(row.slug)}` },
              {
                id: 'copy',
                label: 'Copy Link URL',
                onSelect: async () => {
                  await navigator.clipboard.writeText(`${window.location.origin}/pay/${row.slug}`)
                },
              },
              { id: 'transactions', label: 'Show Transactions', href: `/backend/checkout/transactions?linkId=${encodeURIComponent(row.id)}` },
              {
                id: 'delete',
                label: 'Delete',
                onSelect: async () => {
                  await apiCallOrThrow(`/api/checkout/links/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
                  void loadRows()
                },
              },
            ]} />
          )}
        />
      </PageBody>
    </Page>
  )
}
