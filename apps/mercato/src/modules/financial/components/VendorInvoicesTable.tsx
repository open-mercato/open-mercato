'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useT, useLocale, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useVendorOptions } from './apOptions'

const RESOURCE = 'financial/ap/invoices'
const CREATE_HREF = '/backend/financial/payables/invoices/create'
const detailHref = (id: string) => `/backend/financial/payables/invoices/${id}`

export type VendorInvoiceRow = {
  id: string
  vendor_id: string
  internal_number: string
  vendor_invoice_number?: string | null
  issue_date?: string | null
  due_date?: string | null
  currency_code: string
  grand_total_gross_amount?: string | null
  status: string
  updated_at?: string | null
  updatedAt?: string | null
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  posted: 'Posted',
  paid: 'Paid',
  void: 'Void',
}

export default function VendorInvoicesTable() {
  const t = useT()
  const locale = useLocale()
  const direction = useDirection()
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  const [page, setPage] = React.useState(1)
  const { labels } = useVendorOptions()
  const statusFilter = typeof values.status === 'string' ? values.status : undefined
  const vendorFilter = typeof values.vendorId === 'string' ? values.vendorId : undefined
  const { vendors } = useVendorOptions()

  const query = useQuery({
    queryKey: ['financial-ap-invoices', search, statusFilter, vendorFilter, page],
    queryFn: () => fetchCrudList<VendorInvoiceRow>(RESOURCE, {
      page,
      pageSize: 50,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(vendorFilter ? { vendorId: vendorFilter } : {}),
      sortField: 'issueDate',
      sortDir: 'desc',
    }),
  })
  const data = query.data
  const rows = data?.items ?? []

  const columns = React.useMemo<ColumnDef<VendorInvoiceRow>[]>(() => [
    {
      accessorKey: 'internal_number',
      header: t('financial.ap.invoices.columns.number', 'Invoice'),
      cell: ({ row }) => <Link className="font-mono text-xs underline" href={detailHref(row.original.id)}>{row.original.internal_number}</Link>,
    },
    { accessorKey: 'vendor_id', header: t('financial.ap.invoices.columns.vendor', 'Vendor'), cell: ({ row }) => <span className="text-sm">{labels.get(row.original.vendor_id) ?? '—'}</span> },
    { accessorKey: 'issue_date', header: t('financial.ap.invoices.columns.issueDate', 'Issued'), cell: ({ getValue }) => <span className="text-sm">{formatDate(getValue() as string | null, locale) ?? '—'}</span> },
    { accessorKey: 'due_date', header: t('financial.ap.invoices.columns.dueDate', 'Due'), cell: ({ getValue }) => <span className="text-sm">{formatDate(getValue() as string | null, locale) ?? '—'}</span> },
    {
      accessorKey: 'grand_total_gross_amount',
      header: t('financial.ap.invoices.columns.total', 'Total'),
      cell: ({ getValue }) => <span className="text-sm font-medium">{String(getValue() ?? '0')}</span>,
    },
    {
      accessorKey: 'status',
      header: t('financial.ap.invoices.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const status = String(getValue() ?? 'draft')
        return <Badge variant={status === 'void' ? 'secondary' : status === 'draft' ? 'outline' : 'default'}>{t(`financial.ap.invoices.status.${status}`, STATUS_LABELS[status] ?? status)}</Badge>
      },
    },
  ], [t, locale, labels])

  if (query.isError) return <p className="text-sm text-destructive">{t('financial.ap.invoices.error.load', 'Could not load vendor invoices.')}</p>

  return (
    <DataTable
      title={t('financial.ap.invoices.page.title', 'Vendor invoices')}
      titleHeadingLevel={1}
      actions={<Button asChild><Link href={CREATE_HREF}>{t('financial.ap.invoices.actions.create', 'New invoice')}</Link></Button>}
      rowActions={(row) => <Link className="text-sm font-medium underline" href={detailHref(row.id)}>{t('financial.ap.invoices.actions.open', 'Open')}</Link>}
      columns={columns}
      data={rows}
      searchValue={search}
      onSearchChange={(value) => { setSearch(value); setPage(1) }}
      searchPlaceholder={t('financial.ap.invoices.searchPlaceholder', 'Invoice number')}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'status',
          label: t('financial.ap.invoices.filters.status', 'Status'),
          type: 'select',
          options: ['draft', 'posted', 'paid', 'void'].map((status) => ({ value: status, label: t(`financial.ap.invoices.status.${status}`, STATUS_LABELS[status]) })),
        },
        {
          id: 'vendorId',
          label: t('financial.ap.invoices.filters.vendor', 'Vendor'),
          type: 'select',
          options: vendors.map((vendor) => ({ value: vendor.id, label: `${vendor.code} — ${vendor.name}` })),
        },
      ]}
      filterValues={values}
      onFiltersApply={(next) => { setValues(next); setPage(1) }}
      onFiltersClear={() => { setValues({}); setPage(1) }}
      entityId="financial:ap_vendor_invoice"
      pagination={{
        page,
        pageSize: 50,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
        totalIsCapped: data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={query.isLoading}
    />
  )
}
