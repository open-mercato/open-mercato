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
import { FileText, ArrowLeft, CheckCircle2, AlertTriangle, Clock } from 'lucide-react'

type BillRow = {
  id: string
  vendorBillNumber: string
  purchaseOrderId: string
  purchaseOrderNumber: string
  billDate: string
  status: string
  matchingStatus: string
  exceptionNotes?: string | null
  totalNet: string
  totalGross: string
  linesCount: number
  createdAt: string
}

type ListResponse = {
  items: BillRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function MatchingBadge({ status }: { status: string }) {
  if (status === 'verified') {
    return (
      <StatusBadge variant="success" dot>
        Verified
      </StatusBadge>
    )
  }
  if (status === 'exception') {
    return (
      <StatusBadge variant="error" dot>
        Exception
      </StatusBadge>
    )
  }
  return (
    <StatusBadge variant="warning" dot>
      Pending Match
    </StatusBadge>
  )
}

export default function PurchasesBillsPage() {
  const t = useT()
  const router = useRouter()
  const [data, setData] = React.useState<BillRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiCall<ListResponse>(`/api/purchases/bills?page=${page}&pageSize=${pageSize}`)
      if (res.ok && res.result) {
        setData(res.result.items)
        setTotal(res.result.total)
      } else {
        flash('Failed to load bills', 'error')
      }
    } catch {
      flash('Error connecting to purchasing API', 'error')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const handleVerify = React.useCallback(async (billId: string) => {
    try {
      const res = await apiCall<{ verified: boolean; matchingStatus: string; exceptions: string[] }>(
        `/api/purchases/bills/${billId}/verify-match`,
        { method: 'POST' }
      )
      if (res.ok && res.result) {
        if (res.result.verified) {
          flash('3-way match verified successfully! Bill posted.', 'success')
        } else {
          flash(`Match exception detected: ${res.result.exceptions.join('; ')}`, 'warning')
        }
        loadData()
      } else {
        flash('Verification failed', 'error')
      }
    } catch {
      flash('Failed to run verification', 'error')
    }
  }, [loadData])

  const columns = React.useMemo<ColumnDef<BillRow>[]>(
    () => [
      {
        id: 'vendorBillNumber',
        header: 'Bill Number',
        accessorKey: 'vendorBillNumber',
        cell: ({ row }) => (
          <Link
            href={`/backend/purchases/bills/${row.original.id}`}
            className="font-medium text-primary hover:underline flex items-center gap-1.5"
          >
            <FileText className="h-4 w-4 text-muted-foreground" />
            {row.original.vendorBillNumber}
          </Link>
        ),
      },
      {
        id: 'purchaseOrder',
        header: 'Purchase Order',
        accessorKey: 'purchaseOrderNumber',
        cell: ({ row }) => (
          <Link
            href={`/backend/purchases/orders/${row.original.purchaseOrderId}`}
            className="text-primary hover:underline font-mono text-xs"
          >
            {row.original.purchaseOrderNumber}
          </Link>
        ),
      },
      {
        id: 'billDate',
        header: 'Bill Date',
        accessorKey: 'billDate',
        cell: ({ row }) =>
          row.original.billDate ? new Date(row.original.billDate).toLocaleDateString() : '—',
      },
      {
        id: 'matchingStatus',
        header: '3-Way Match',
        accessorKey: 'matchingStatus',
        cell: ({ row }) => <MatchingBadge status={row.original.matchingStatus} />,
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => {
          const v = row.original.status === 'posted' ? 'success' : 'neutral'
          return <StatusBadge variant={v}>{row.original.status.toUpperCase()}</StatusBadge>
        },
      },
      {
        id: 'totalNet',
        header: 'Total Net',
        accessorKey: 'totalNet',
        cell: ({ row }) => (
          <span className="font-mono text-sm">{Number(row.original.totalNet).toFixed(2)}</span>
        ),
      },
      {
        id: 'totalGross',
        header: 'Total Gross',
        accessorKey: 'totalGross',
        cell: ({ row }) => (
          <span className="font-mono text-sm font-semibold">{Number(row.original.totalGross).toFixed(2)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end">
            <RowActions
              items={[
                {
                  id: 'view',
                  label: 'View details',
                  onSelect: () => router.push(`/backend/purchases/bills/${row.original.id}`),
                },
                ...(row.original.matchingStatus !== 'verified'
                  ? [
                      {
                        id: 'verify',
                        label: 'Verify 3-Way Match',
                        onSelect: () => handleVerify(row.original.id),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        ),
      },
    ],
    [router, handleVerify]
  )

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Vendor Bills & 3-Way Match</h1>
              <p className="text-sm text-muted-foreground">
                Reconcile supplier invoices against purchase orders and incoming goods receipts (PZ).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/backend/purchases/orders">
                <Button variant="outline" size="sm" aria-label="Back to orders">
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Purchase Orders
                </Button>
              </Link>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={data}
            isLoading={loading}
            pagination={{
              page,
              pageSize,
              total,
              totalPages: Math.ceil(total / pageSize) || 1,
              onPageChange: setPage,
              onPageSizeChange: setPageSize,
            }}
          />
        </div>
      </PageBody>
    </Page>
  )
}
