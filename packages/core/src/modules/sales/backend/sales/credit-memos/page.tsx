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

type CreditMemoRow = {
  id: string
  creditMemoNumber: string
  status?: string | null
  reason?: string | null
  issueDate?: string | null
  currencyCode?: string
  grandTotalGrossAmount?: string
}

export default function SalesCreditMemosPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<CreditMemoRow[]>([])
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
      const result = await apiCall<{ items?: CreditMemoRow[]; total?: number; totalPages?: number }>(
        `/api/sales/credit-memos?${params.toString()}`
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

  const columns = React.useMemo<ColumnDef<CreditMemoRow, unknown>[]>(() => [
    {
      id: 'creditMemoNumber',
      accessorKey: 'creditMemoNumber',
      header: t('sales.credit_memos.columns.number', 'Number'),
      cell: ({ row }) => (
        <Link href={`/backend/sales/credit-memos/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.creditMemoNumber}
        </Link>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t('sales.credit_memos.columns.status', 'Status'),
    },
    {
      id: 'reason',
      accessorKey: 'reason',
      header: t('sales.credit_memos.columns.reason', 'Reason'),
      cell: ({ getValue }) => {
        const val = getValue() as string | null
        return val ? (val.length > 60 ? `${val.slice(0, 60)}...` : val) : ''
      },
    },
    {
      id: 'issueDate',
      accessorKey: 'issueDate',
      header: t('sales.credit_memos.columns.issueDate', 'Issue Date'),
      cell: ({ getValue }) => {
        const val = getValue() as string | null
        return val ? new Date(val).toLocaleDateString() : ''
      },
    },
    {
      id: 'grandTotalGrossAmount',
      accessorKey: 'grandTotalGrossAmount',
      header: t('sales.credit_memos.columns.total', 'Total'),
      cell: ({ row }) => {
        const amount = row.original.grandTotalGrossAmount
        const currency = row.original.currencyCode
        return amount ? `${Number(amount).toFixed(2)} ${currency ?? ''}` : ''
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <RowActions
          items={[{ id: 'view', label: t('common.view', 'View'), href: `/backend/sales/credit-memos/${row.original.id}` }]}
        />
      ),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable<CreditMemoRow>
          columns={columns}
          data={rows}
          sorting={sorting}
          onSortingChange={setSorting}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={(val) => { setSearch(val); setPage(1) }}
          searchPlaceholder={t('sales.credit_memos.search', 'Search credit memos...')}
          emptyState={t('sales.credit_memos.empty.title', 'No credit memos yet')}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
