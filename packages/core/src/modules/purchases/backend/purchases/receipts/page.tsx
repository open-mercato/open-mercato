"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PackageCheck, ArrowLeft } from 'lucide-react'

type ReceiptRow = {
  id: string
  receiptNumber: string
  status: string
  isBackorder: boolean
  backorderOfId?: string | null
  purchaseOrder?: { id: string; orderNumber: string } | null
  receivedDate?: string | null
  createdAt: string
  lines?: unknown[]
}

type ListResponse = {
  items: ReceiptRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  error?: string
}

export default function GoodsReceiptsListPage() {
  const t = useT()
  const router = useRouter()

  const [items, setItems] = React.useState<ReceiptRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(50)
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(true)

  const fetchReceipts = React.useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (search.trim()) params.set('search', search.trim())

      const call = await apiCall<ListResponse>(`/api/purchases/receipts?${params.toString()}`)
      if (call.ok && call.result) {
        setItems(call.result.items || [])
        setTotal(call.result.total || 0)
      } else {
        setItems([])
        setTotal(0)
      }
    } catch (err: unknown) {
      flash((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, search])

  React.useEffect(() => {
    fetchReceipts()
  }, [fetchReceipts])

  const columns = React.useMemo<ColumnDef<ReceiptRow>[]>(
    () => [
      {
        id: 'receiptNumber',
        accessorKey: 'receiptNumber',
        header: t('purchases.receipts.columns.number', 'Receipt # (PZ)'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link
              href={`/backend/purchases/receipts/${row.original.id}`}
              className="font-medium text-primary hover:underline"
            >
              {row.original.receiptNumber}
            </Link>
            {row.original.isBackorder && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
                Backorder
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'orderNumber',
        header: t('purchases.receipts.columns.order', 'Source PO'),
        cell: ({ row }) =>
          row.original.purchaseOrder ? (
            <Link
              href={`/backend/purchases/orders/${row.original.purchaseOrder.id}`}
              className="text-muted-foreground hover:underline"
            >
              {row.original.purchaseOrder.orderNumber}
            </Link>
          ) : (
            '-'
          ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: t('purchases.receipts.columns.status', 'Status'),
        cell: ({ row }) => {
          const s = row.original.status
          const variant = s === 'done' ? 'success' : s === 'ready' ? 'info' : 'neutral'
          return (
            <StatusBadge variant={variant} dot>
              {s === 'done' ? 'Received (Done)' : s === 'ready' ? 'Ready to Check In' : s}
            </StatusBadge>
          )
        },
      },
      {
        id: 'receivedDate',
        accessorKey: 'receivedDate',
        header: t('purchases.receipts.columns.date', 'Received Date'),
        cell: ({ row }) =>
          row.original.receivedDate
            ? new Date(row.original.receivedDate).toLocaleDateString()
            : new Date(row.original.createdAt).toLocaleDateString(),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <RowActions
            items={[
              {
                id: 'inspect',
                label: row.original.status === 'done' ? t('common.view', 'View Receipt') : t('purchases.receipts.check_in', 'Inspect & Check In'),
                onSelect: () => router.push(`/backend/purchases/receipts/${row.original.id}`),
              },
            ]}
          />
        ),
      },
    ],
    [router, t]
  )

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/backend/purchases/orders">
              <Button variant="outline" size="sm" aria-label="Back to orders">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {t('purchases.receipts.title', 'Goods Receipts (PZ)')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('purchases.receipts.subtitle', 'Inbound warehouse receipts, quantity validation, and backorders.')}
              </p>
            </div>
          </div>
        </div>

        <DataTable<ReceiptRow>
          columns={columns}
          data={items}
          isLoading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('purchases.receipts.search', 'Search receipt #, order...')}
          pagination={{
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize) || 1,
            onPageChange: setPage,
            onPageSizeChange: setPageSize,
          }}
        />
      </PageBody>
    </Page>
  )
}
