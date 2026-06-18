"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { FileText } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { formatMoney, normalizeNumber } from './lineItemUtils'

type InvoiceRow = {
  id: string
  orderId: string | null
  invoiceNumber: string
  status: string | null
  issueDate: string | null
  dueDate: string | null
  currencyCode: string | null
  grandTotalGrossAmount: number
  outstandingAmount: number
  updatedAt: string | null
}

type InvoicesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 20

function readString(map: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = map[key]
    if (typeof value === 'string' && value.trim().length) return value
  }
  return null
}

function readNumber(map: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = map[key]
    const normalized = normalizeNumber(value, Number.NaN)
    if (Number.isFinite(normalized)) return normalized
  }
  return 0
}

function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function normalizeInvoice(item: Record<string, unknown>): InvoiceRow | null {
  const id = readString(item, 'id')
  if (!id) return null
  return {
    id,
    orderId: readString(item, 'orderId', 'order_id'),
    invoiceNumber: readString(item, 'invoiceNumber', 'invoice_number') ?? id,
    status: readString(item, 'status'),
    issueDate: readString(item, 'issueDate', 'issue_date'),
    dueDate: readString(item, 'dueDate', 'due_date'),
    currencyCode: readString(item, 'currencyCode', 'currency_code'),
    grandTotalGrossAmount: readNumber(item, 'grandTotalGrossAmount', 'grand_total_gross_amount'),
    outstandingAmount: readNumber(item, 'outstandingAmount', 'outstanding_amount'),
    updatedAt: readString(item, 'updatedAt', 'updated_at'),
  }
}

export function SalesInvoicesTable() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'sales-invoices-table',
  })
  const [rows, setRows] = React.useState<InvoiceRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [search, setSearch] = React.useState('')
  const [isLoading, setLoading] = React.useState(false)
  const [cacheStatus, setCacheStatus] = React.useState<'hit' | 'miss' | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  const loadInvoices = React.useCallback(async () => {
    setLoading(true)
    try {
      const sort = sorting[0]
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (search.trim()) params.set('search', search.trim())
      if (sort) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      const response = await apiCall<InvoicesResponse>(
        `/api/sales/invoices?${params.toString()}`,
        undefined,
        { fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(response.result?.items) ? response.result?.items ?? [] : []
      setRows(items.map(normalizeInvoice).filter((row): row is InvoiceRow => Boolean(row)))
      setTotal(typeof response.result?.total === 'number' ? response.result.total : items.length)
      setTotalPages(typeof response.result?.totalPages === 'number' ? response.result.totalPages : 1)
      setCacheStatus(response.cacheStatus)
    } catch (err) {
      console.error('sales.invoices.list', err)
      setRows([])
      setTotal(0)
      setTotalPages(1)
      flash(t('sales.invoices.errors.load', 'Failed to load invoices.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [page, search, sorting, t])

  React.useEffect(() => {
    void loadInvoices()
  }, [loadInvoices, reloadToken, scopeVersion])

  const handleDelete = React.useCallback(async (row: InvoiceRow) => {
    const confirmed = await confirm({
      title: t('sales.invoices.delete.confirmTitle', 'Delete invoice {invoiceNumber}?', { invoiceNumber: row.invoiceNumber }),
      description: t('sales.invoices.delete.confirmDescription', 'This action cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: async () => {
          await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt),
            () =>
              deleteCrud('sales/invoices', {
                body: { id: row.id },
                errorMessage: t('sales.invoices.delete.error', 'Failed to delete invoice.'),
              }),
          )
        },
        context: {
          formId: 'sales-invoices-table',
          resourceKind: 'sales.invoice',
          resourceId: row.id,
          retryLastMutation,
        },
      })
      flash(t('sales.invoices.delete.success', 'Invoice deleted.'), 'success')
      setReloadToken((token) => token + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sales.invoices.delete.error', 'Failed to delete invoice.')
      flash(message, 'error')
    }
  }, [confirm, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<InvoiceRow>[]>(() => [
    {
      id: 'invoiceNumber',
      accessorKey: 'invoiceNumber',
      header: t('sales.invoices.table.invoice', 'Invoice'),
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-medium">{row.original.invoiceNumber}</span>
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t('sales.invoices.table.status', 'Status'),
      cell: ({ row }) => row.original.status ? <Badge variant="secondary">{row.original.status}</Badge> : <span className="text-sm text-muted-foreground">-</span>,
    },
    {
      id: 'orderId',
      accessorKey: 'orderId',
      header: t('sales.invoices.table.sourceOrder', 'Source order'),
      enableSorting: false,
      cell: ({ row }) =>
        row.original.orderId ? (
          <Link className="text-sm text-primary hover:underline" href={`/backend/sales/orders/${row.original.orderId}?kind=order`}>
            {t('sales.invoices.table.openOrder', 'Open order')}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        ),
    },
    {
      id: 'issueDate',
      accessorKey: 'issueDate',
      header: t('sales.invoices.table.issueDate', 'Issue date'),
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDisplayDate(row.original.issueDate) || '-'}</span>,
    },
    {
      id: 'dueDate',
      accessorKey: 'dueDate',
      header: t('sales.invoices.table.dueDateHeader', 'Due date'),
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDisplayDate(row.original.dueDate) || '-'}</span>,
    },
    {
      id: 'grandTotalGrossAmount',
      accessorKey: 'grandTotalGrossAmount',
      header: t('sales.invoices.table.total', 'Total'),
      cell: ({ row }) => <span className="text-sm font-medium">{formatMoney(row.original.grandTotalGrossAmount, row.original.currencyCode)}</span>,
    },
    {
      id: 'outstandingAmount',
      accessorKey: 'outstandingAmount',
      header: t('sales.invoices.table.outstanding', 'Outstanding'),
      cell: ({ row }) => <span className="text-sm font-medium">{formatMoney(row.original.outstandingAmount, row.original.currencyCode)}</span>,
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable<InvoiceRow>
          stickyActionsColumn
          title={(
            <div className="flex flex-col">
              <span>{t('sales.invoices.list.title', 'Sales invoices')}</span>
              <span className="text-sm font-normal text-muted-foreground">
                {t('sales.invoices.list.subtitle', 'Review invoice totals, dates, source orders, and balances.')}
              </span>
            </div>
          )}
          columns={columns}
          data={rows}
          sorting={sorting}
          onSortingChange={setSorting}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('sales.invoices.list.search', 'Search invoices…')}
          entityId={E.sales.sales_invoice}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
            cacheStatus,
          }}
          refreshButton={{
            label: t('sales.invoices.list.refresh', 'Refresh'),
            onRefresh: () => setReloadToken((token) => token + 1),
            isRefreshing: isLoading,
          }}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'open',
                  label: t('sales.invoices.list.open', 'Open'),
                  href: `/backend/sales/invoices/${row.id}`,
                },
                {
                  id: 'delete',
                  label: t('sales.invoices.delete.action', 'Delete invoice'),
                  onSelect: () => void handleDelete(row),
                },
              ]}
            />
          )}
          perspective={{ tableId: 'sales.invoices' }}
          onRowClick={(row) => router.push(`/backend/sales/invoices/${row.id}`)}
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('sales.invoices.list.empty', 'No invoices yet.')}
            </div>
          }
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
