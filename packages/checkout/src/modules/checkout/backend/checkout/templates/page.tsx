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
  const t = useT()
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
      label: t('checkout.admin.templates.filters.pricingMode'),
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
    { accessorKey: 'name', header: t('checkout.admin.templates.columns.name') },
    {
      accessorKey: 'pricingMode',
      header: t('checkout.admin.templates.columns.pricingMode'),
      cell: ({ row }) => {
        const mode = row.original.pricingMode
        if (mode === 'fixed') return t('checkout.linkTemplateForm.pricing.modes.fixed')
        if (mode === 'custom_amount') return t('checkout.linkTemplateForm.pricing.modes.customAmount')
        if (mode === 'price_list') return t('checkout.linkTemplateForm.pricing.modes.priceList')
        return mode
      },
    },
    {
      accessorKey: 'gatewayProviderKey',
      header: t('checkout.admin.templates.columns.gateway'),
      cell: ({ row }) => row.original.gatewayProviderKey ?? t('checkout.common.emptyValue'),
    },
    {
      accessorKey: 'maxCompletions',
      header: t('checkout.admin.templates.columns.maxUses'),
      cell: ({ row }) => row.original.maxCompletions ?? t('checkout.admin.templates.unlimited'),
    },
    {
      accessorKey: 'createdAt',
      header: t('checkout.admin.templates.columns.created'),
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('checkout.admin.templates.title')}
          columns={columns}
          data={rows}
          isLoading={loading}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('checkout.admin.templates.searchPlaceholder')}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(next) => { setFilters(next); setPage(1) }}
          onFiltersClear={() => { setFilters({}); setPage(1) }}
          pagination={{ page, pageSize: 25, total, totalPages, onPageChange: setPage }}
          perspective={{ tableId: 'checkout-templates' }}
          actions={(
            <Button asChild>
              <Link href="/backend/checkout/templates/create">
                <Plus className="mr-2 h-4 w-4" />
                {t('checkout.admin.templates.actions.create')}
              </Link>
            </Button>
          )}
          rowActions={(row) => (
            <RowActions items={[
              { id: 'edit', label: t('checkout.common.actions.edit'), href: `/backend/checkout/templates/${encodeURIComponent(row.id)}` },
              {
                id: 'preview',
                label: t('checkout.common.actions.preview'),
                onSelect: () => window.open(`/backend/checkout/templates/${encodeURIComponent(row.id)}/preview`, '_blank', 'noopener,noreferrer'),
              },
              { id: 'create-link', label: t('checkout.admin.templates.actions.createLinkFromTemplate'), href: `/backend/checkout/pay-links/create?templateId=${encodeURIComponent(row.id)}` },
              {
                id: 'delete',
                label: t('checkout.common.actions.delete'),
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
