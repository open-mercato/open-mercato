'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useT, useLocale, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useVendorOptions } from './apOptions'

const RESOURCE = 'financial/ap/payments'
const CREATE_HREF = '/backend/financial/payables/payments/create'

export type VendorPaymentRow = {
  id: string
  vendor_id: string
  payment_number: string
  payment_date?: string | null
  currency_code: string
  gross_amount?: string | null
  withholding_amount?: string | null
  net_amount?: string | null
  method?: string | null
  status: string
}

export default function VendorPaymentsTable() {
  const t = useT()
  const locale = useLocale()
  const direction = useDirection()
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const { labels } = useVendorOptions()
  const query = useQuery({
    queryKey: ['financial-ap-payments', search, page],
    queryFn: () => fetchCrudList<VendorPaymentRow>(RESOURCE, {
      page,
      pageSize: 50,
      ...(search.trim() ? { search: search.trim() } : {}),
      sortField: 'paymentDate',
      sortDir: 'desc',
    }),
  })
  const data = query.data
  const rows = data?.items ?? []

  const columns = React.useMemo<ColumnDef<VendorPaymentRow>[]>(() => [
    { accessorKey: 'payment_number', header: t('financial.ap.payments.columns.number', 'Payment'), cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '')}</span> },
    { accessorKey: 'vendor_id', header: t('financial.ap.payments.columns.vendor', 'Vendor'), cell: ({ row }) => <span className="text-sm">{labels.get(row.original.vendor_id) ?? '—'}</span> },
    { accessorKey: 'payment_date', header: t('financial.ap.payments.columns.date', 'Date'), cell: ({ getValue }) => <span className="text-sm">{formatDate(getValue() as string | null, locale) ?? '—'}</span> },
    { accessorKey: 'gross_amount', header: t('financial.ap.payments.columns.gross', 'Gross'), cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? '0')}</span> },
    { accessorKey: 'withholding_amount', header: t('financial.ap.payments.columns.withholding', 'WHT'), cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? '0')}</span> },
    { accessorKey: 'net_amount', header: t('financial.ap.payments.columns.net', 'Net'), cell: ({ getValue }) => <span className="text-sm font-medium">{String(getValue() ?? '0')}</span> },
    { accessorKey: 'status', header: t('financial.ap.payments.columns.status', 'Status'), cell: ({ getValue }) => <Badge variant={getValue() === 'void' ? 'secondary' : 'default'}>{String(getValue() ?? 'posted')}</Badge> },
  ], [t, locale, labels])

  if (query.isError) return <p className="text-sm text-destructive">{t('financial.ap.payments.error.load', 'Could not load vendor payments.')}</p>

  return (
    <DataTable
      title={t('financial.ap.payments.page.title', 'Vendor payments')}
      titleHeadingLevel={1}
      actions={<Button asChild><Link href={CREATE_HREF}>{t('financial.ap.payments.actions.create', 'Record payment')}</Link></Button>}
      columns={columns}
      data={rows}
      searchValue={search}
      onSearchChange={(value) => { setSearch(value); setPage(1) }}
      searchPlaceholder={t('financial.ap.payments.searchPlaceholder', 'Payment number or reference')}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      entityId="financial:ap_payment"
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
