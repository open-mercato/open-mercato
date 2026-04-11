"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const PAGE_SIZE = 50

type InvoiceRow = {
  id: string
  invoiceNumber: string
  status?: string | null
  issueDate?: string | null
  dueDate?: string | null
  currencyCode?: string
  grandTotalGrossAmount?: string
  paidTotalAmount?: string
  outstandingAmount?: string
}

export default function SalesInvoicesPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<InvoiceRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [search, setSearch] = React.useState('')
  const [isLoading, setLoading] = React.useState(false)

  const fetchData = React.useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (search.trim()) params.set('search', search.trim())
      if (sorting.length > 0) {
        params.set('sortField', sorting[0].id)
        params.set('sortDir', sorting[0].desc ? 'desc' : 'asc')
      }
      const result = await apiCall<{ items?: InvoiceRow[]; total?: number; totalPages?: number }>(
        `/api/sales/invoices?${params.toString()}`
      )
      if (result.ok && result.result) {
        setRows(Array.isArray(result.result.items) ? result.result.items : [])
        setTotal(result.result.total ?? 0)
        setTotalPages(result.result.totalPages ?? 1)
      } else {
        setRows([])
      }
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [page, search, sorting])

  React.useEffect(() => { fetchData() }, [fetchData, scopeVersion])

  const columns = React.useMemo<ColumnDef<InvoiceRow, unknown>[]>(() => [
    {
      id: 'invoiceNumber',
      accessorKey: 'invoiceNumber',
      header: t('sales.invoices.columns.number', 'Number'),
      cell: ({ row }) => (
        <Link href={`/backend/sales/invoices/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.invoiceNumber}
        </Link>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t('sales.invoices.columns.status', 'Status'),
    },
    {
      id: 'issueDate',
      accessorKey: 'issueDate',
      header: t('sales.invoices.columns.issueDate', 'Issue Date'),
      cell: ({ getValue }) => {
        const val = getValue() as string | null
        return val ? new Date(val).toLocaleDateString() : ''
      },
    },
    {
      id: 'grandTotalGrossAmount',
      accessorKey: 'grandTotalGrossAmount',
      header: t('sales.invoices.columns.total', 'Total'),
      cell: ({ row }) => {
        const amount = row.original.grandTotalGrossAmount
        const currency = row.original.currencyCode
        return amount ? `${Number(amount).toFixed(2)} ${currency ?? ''}` : ''
      },
    },
    {
      id: 'outstandingAmount',
      accessorKey: 'outstandingAmount',
      header: t('sales.invoices.columns.outstanding', 'Outstanding'),
      cell: ({ row }) => {
        const amount = row.original.outstandingAmount
        const currency = row.original.currencyCode
        return amount && Number(amount) > 0 ? `${Number(amount).toFixed(2)} ${currency ?? ''}` : ''
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <RowActions
          items={[{ id: 'view', label: t('common.view', 'View'), href: `/backend/sales/invoices/${row.original.id}` }]}
        />
      ),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable<InvoiceRow>
          columns={columns}
          data={rows}
          sorting={sorting}
          onSortingChange={setSorting}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={(val) => { setSearch(val); setPage(1) }}
          searchPlaceholder={t('sales.invoices.search', 'Search invoices...')}
          emptyState={t('sales.invoices.empty.title', 'No invoices yet')}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
