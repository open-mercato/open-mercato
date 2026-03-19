"use client"
import * as React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
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
  status: 'draft' | 'active' | 'inactive'
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

export default function CheckoutPayLinksPage() {
  const t = useT()
  const [rows, setRows] = React.useState<LinkRow[]>([])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('checkout.admin.payLinks.filters.status'),
      type: 'select',
      options: [
        { value: 'draft', label: t('checkout.common.status.draft') },
        { value: 'active', label: t('checkout.common.status.active') },
        { value: 'inactive', label: t('checkout.common.status.inactive') },
      ],
    },
    {
      id: 'pricingMode',
      label: t('checkout.admin.payLinks.filters.pricing'),
      type: 'select',
      options: [
        { value: 'fixed', label: t('checkout.linkTemplateForm.pricing.modes.fixed') },
        { value: 'custom_amount', label: t('checkout.linkTemplateForm.pricing.modes.customAmount') },
        { value: 'price_list', label: t('checkout.linkTemplateForm.pricing.modes.priceList') },
      ],
    },
  ], [t])

  const loadRows = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '25',
      search,
    })
    if (typeof filters.status === 'string' && filters.status) params.set('status', filters.status)
    if (typeof filters.pricingMode === 'string' && filters.pricingMode) params.set('pricingMode', filters.pricingMode)
    const result = await readApiResultOrThrow<ListResponse>(`/api/checkout/links?${params.toString()}`)
    setRows(result.items ?? [])
    setTotal(result.total ?? 0)
    setTotalPages(result.totalPages ?? 1)
    setLoading(false)
  }, [filters.pricingMode, filters.status, page, search])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<LinkRow>[]>(() => [
    { accessorKey: 'name', header: t('checkout.admin.payLinks.columns.name') },
    {
      accessorKey: 'slug',
      header: t('checkout.admin.payLinks.columns.slug'),
      cell: ({ row }) => <span className="font-mono text-xs">/pay/{row.original.slug}</span>,
    },
    {
      accessorKey: 'pricingMode',
      header: t('checkout.admin.payLinks.columns.pricing'),
      cell: ({ row }) => {
        if (row.original.pricingMode === 'fixed') {
          return t('checkout.admin.payLinks.pricing.fixed', {
            amount: row.original.fixedPriceAmount?.toFixed(2) ?? '0.00',
            currency: row.original.fixedPriceCurrencyCode ?? '',
          }).trim()
        }
        if (row.original.pricingMode === 'custom_amount') {
          return t('checkout.admin.payLinks.pricing.customAmount', {
            min: row.original.customAmountMin?.toFixed(2) ?? '0.00',
            max: row.original.customAmountMax?.toFixed(2) ?? '0.00',
            currency: row.original.customAmountCurrencyCode ?? '',
          }).trim()
        }
        return t('checkout.linkTemplateForm.pricing.modes.priceList')
      },
    },
    {
      accessorKey: 'status',
      header: t('checkout.admin.payLinks.columns.status'),
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'active' ? 'default' : 'secondary'}>
          {t(`checkout.common.status.${row.original.status}`)}
        </Badge>
      ),
    },
    {
      accessorKey: 'completionCount',
      header: t('checkout.admin.payLinks.columns.uses'),
      cell: ({ row }) => `${row.original.completionCount} / ${row.original.maxCompletions ?? '∞'}`,
    },
    {
      accessorKey: 'createdAt',
      header: t('checkout.admin.payLinks.columns.created'),
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('checkout.admin.payLinks.title')}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('checkout.admin.payLinks.searchPlaceholder')}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(next) => { setFilters(next); setPage(1) }}
          onFiltersClear={() => { setFilters({}); setPage(1) }}
          pagination={{ page, pageSize: 25, total, totalPages, onPageChange: setPage }}
          isLoading={loading}
          perspective={{ tableId: 'checkout-links' }}
          actions={(
            <Button asChild>
              <Link href="/backend/checkout/pay-links/create">
                <Plus className="mr-2 h-4 w-4" />
                {t('checkout.admin.payLinks.actions.create')}
              </Link>
            </Button>
          )}
          rowActions={(row) => (
            <RowActions items={[
              { id: 'edit', label: t('checkout.common.actions.edit'), href: `/backend/checkout/pay-links/${encodeURIComponent(row.id)}` },
              { id: 'preview', label: t('checkout.common.actions.preview'), href: `/pay/${encodeURIComponent(row.slug)}?preview=true` },
              ...(row.status === 'active'
                ? [{ id: 'view', label: t('checkout.admin.payLinks.actions.viewPayPage'), href: `/pay/${encodeURIComponent(row.slug)}` }]
                : []),
              {
                id: 'copy',
                label: t('checkout.admin.payLinks.actions.copyUrl'),
                onSelect: async () => {
                  await navigator.clipboard.writeText(`${window.location.origin}/pay/${row.slug}`)
                },
              },
              { id: 'transactions', label: t('checkout.admin.payLinks.actions.showTransactions'), href: `/backend/checkout/transactions?linkId=${encodeURIComponent(row.id)}` },
              ...(row.status !== 'active'
                ? [{
                  id: 'publish',
                  label: t('checkout.admin.payLinks.actions.publish'),
                  onSelect: async () => {
                    await apiCallOrThrow(`/api/checkout/links/${encodeURIComponent(row.id)}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'active' }),
                    })
                    void loadRows()
                  },
                }]
                : [{
                  id: 'deactivate',
                  label: t('checkout.admin.payLinks.actions.deactivate'),
                  onSelect: async () => {
                    await apiCallOrThrow(`/api/checkout/links/${encodeURIComponent(row.id)}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'inactive' }),
                    })
                    void loadRows()
                  },
                }]),
              {
                id: 'delete',
                label: t('checkout.common.actions.delete'),
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
