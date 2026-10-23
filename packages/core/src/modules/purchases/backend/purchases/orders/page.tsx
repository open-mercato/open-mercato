"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Plus, Truck } from 'lucide-react'
import { PurchaseOrderStatusBadge } from '../../../components/PurchaseOrderStatusBadge'

type PurchaseOrderRow = {
  id: string
  orderNumber: string
  status: string
  vendorId: string
  vendorName?: string | null
  orderDate: string
  currencyCode: string
  totalGross: string
  deliveryStatus: string
  invoiceStatus: string
  updatedAt: string
}

type ListResponse = {
  items: PurchaseOrderRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  error?: string
}

export default function PurchaseOrdersListPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [items, setItems] = React.useState<PurchaseOrderRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(50)
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(true)

  const fetchOrders = React.useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (search.trim()) params.set('search', search.trim())

      const call = await apiCall<ListResponse>(`/api/purchases/orders?${params.toString()}`)
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
    fetchOrders()
  }, [fetchOrders])

  const handleCancel = React.useCallback(
    async (row: PurchaseOrderRow) => {
      const ok = await confirm({
        title: t('purchases.orders.cancel.confirm_title', 'Cancel Purchase Order'),
        text: t('purchases.orders.cancel.confirm_msg', 'Are you sure you want to cancel {number}?', {
          number: row.orderNumber,
        }),
        confirmText: t('common.cancel', 'Cancel Order'),
        variant: 'destructive',
      })
      if (!ok) return

      try {
        const res = await apiCall<{ error?: string }>(`/api/purchases/orders/${row.id}/cancel`, { method: 'POST' })
        if (!res.ok) {
          throw new Error(res.result?.error || 'Failed to cancel order')
        }
        flash(t('purchases.orders.cancelled_success', 'Order cancelled successfully'), 'success')
        fetchOrders()
      } catch (err: unknown) {
        flash((err as Error).message, 'error')
      }
    },
    [confirm, fetchOrders, t]
  )

  const columns = React.useMemo<ColumnDef<PurchaseOrderRow>[]>(
    () => [
      {
        id: 'orderNumber',
        accessorKey: 'orderNumber',
        header: t('purchases.orders.columns.number', 'Order #'),
        cell: ({ row }) => (
          <Link
            href={`/backend/purchases/orders/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {row.original.orderNumber}
          </Link>
        ),
      },
      {
        id: 'vendorName',
        accessorKey: 'vendorName',
        header: t('purchases.orders.columns.vendor', 'Vendor'),
        cell: ({ row }) => row.original.vendorName || row.original.vendorId,
      },
      {
        id: 'orderDate',
        accessorKey: 'orderDate',
        header: t('purchases.orders.columns.date', 'Order Date'),
        cell: ({ row }) =>
          row.original.orderDate ? new Date(row.original.orderDate).toLocaleDateString() : '-',
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: t('purchases.orders.columns.status', 'Status'),
        cell: ({ row }) => <PurchaseOrderStatusBadge status={row.original.status} />,
      },
      {
        id: 'deliveryStatus',
        accessorKey: 'deliveryStatus',
        header: t('purchases.orders.columns.delivery', 'Delivery'),
        cell: ({ row }) => {
          const ds = row.original.deliveryStatus
          return (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Truck className="h-3.5 w-3.5" />
              <span>{ds === 'fully_received' ? 'Received' : ds === 'partially_received' ? 'Partial' : 'Pending'}</span>
            </div>
          )
        },
      },
      {
        id: 'totalGross',
        accessorKey: 'totalGross',
        header: t('purchases.orders.columns.total', 'Total Gross'),
        cell: ({ row }) => (
          <span className="font-semibold">
            {Number(row.original.totalGross).toFixed(2)} {row.original.currencyCode}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <RowActions
            items={[
              {
                id: 'view',
                label: t('common.view', 'View / Edit'),
                onSelect: () => router.push(`/backend/purchases/orders/${row.original.id}`),
              },
              {
                id: 'cancel',
                label: t('common.cancel', 'Cancel'),
                destructive: true,
                onSelect: () => handleCancel(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [handleCancel, router, t]
  )

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t('purchases.orders.title', 'Purchase Orders & RFQs')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('purchases.orders.subtitle', 'Manage supplier quotations, purchase agreements, and stock receipts.')}
            </p>
          </div>
          <Link href="/backend/purchases/orders/create">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              {t('purchases.orders.create_rfq', 'Create RFQ')}
            </Button>
          </Link>
        </div>

        <DataTable<PurchaseOrderRow>
          columns={columns}
          data={items}
          isLoading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('purchases.orders.search', 'Search orders, vendors...')}
          pagination={{
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize) || 1,
            onPageChange: setPage,
            onPageSizeChange: setPageSize,
          }}
        />

        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
