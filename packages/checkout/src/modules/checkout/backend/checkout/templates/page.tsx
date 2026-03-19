"use client"
import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type TemplateRow = {
  id: string
  name: string
  pricingMode: string
  gatewayProviderKey?: string | null
  maxCompletions?: number | null
  createdAt?: string | null
}

type ListResponse = {
  items: TemplateRow[]
  total: number
  totalPages: number
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

export default function CheckoutTemplatesPage() {
  const [rows, setRows] = React.useState<TemplateRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'pricingMode',
      label: 'Pricing mode',
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
    if (typeof filters.pricingMode === 'string' && filters.pricingMode) params.set('pricingMode', filters.pricingMode)
    const result = await readApiResultOrThrow<ListResponse>(`/api/checkout/templates?${params.toString()}`)
    setRows(result.items ?? [])
    setTotal(result.total ?? 0)
    setTotalPages(result.totalPages ?? 1)
    setLoading(false)
  }, [filters.pricingMode, page, search])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<TemplateRow>[]>(() => [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'pricingMode', header: 'Pricing mode' },
    {
      accessorKey: 'gatewayProviderKey',
      header: 'Gateway',
      cell: ({ row }) => row.original.gatewayProviderKey ?? '—',
    },
    {
      accessorKey: 'maxCompletions',
      header: 'Max uses',
      cell: ({ row }) => row.original.maxCompletions ?? 'Unlimited',
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
  ], [])

  return (
    <Page>
      <PageHeader title="Link Templates" description="Save reusable pay-link configurations." />
      <PageBody>
        <DataTable
          title="Link Templates"
          columns={columns}
          data={rows}
          isLoading={loading}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder="Search templates…"
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(next) => { setFilters(next); setPage(1) }}
          onFiltersClear={() => { setFilters({}); setPage(1) }}
          pagination={{ page, pageSize: 25, total, totalPages, onPageChange: setPage }}
          perspective={{ tableId: 'checkout-templates' }}
          actions={<Button asChild><Link href="/backend/checkout/templates/create">Create Template</Link></Button>}
          rowActions={(row) => (
            <RowActions items={[
              { id: 'edit', label: 'Edit', href: `/backend/checkout/templates/${encodeURIComponent(row.id)}` },
              { id: 'preview', label: 'Preview', href: `/backend/checkout/templates/${encodeURIComponent(row.id)}/preview` },
              { id: 'create-link', label: 'Create Link from Template', href: `/backend/checkout/pay-links/create?templateId=${encodeURIComponent(row.id)}` },
              {
                id: 'delete',
                label: 'Delete',
                onSelect: async () => {
                  await apiCallOrThrow(`/api/checkout/templates/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
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
