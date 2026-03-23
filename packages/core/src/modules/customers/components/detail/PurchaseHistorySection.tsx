"use client"

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Button } from '@open-mercato/ui/primitives/button'

type OrderItem = {
  id: string
  orderNumber: string | null
  totalAmount: string | number | null
  currency: string | null
  status: string | null
  createdAt: string | null
}

type PurchaseSummary = {
  avgMonthlyRevenue: number
  averageOrderValue: number
  frequency: number
  lastOrderDate: string | null
  totalOrders: number
  totalRevenue: number
}

type TopProduct = {
  name: string
  quantity: number
  totalSpent: number
}

type PurchaseHistoryData = {
  orders: OrderItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
  }
  topProducts: TopProduct[]
  summary: PurchaseSummary
  purchaseTrend: 'stable' | 'growing' | 'declining'
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function TrendBadge({ trend }: { trend: PurchaseHistoryData['purchaseTrend'] }) {
  const t = useT()
  const labels: Record<string, string> = {
    stable: t('customers.companies.detail.purchaseHistory.trend.stable', 'Stable'),
    growing: t('customers.companies.detail.purchaseHistory.trend.growing', 'Growing'),
    declining: t('customers.companies.detail.purchaseHistory.trend.declining', 'Declining'),
  }
  const colors: Record<string, string> = {
    stable: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    growing: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    declining: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  }
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${colors[trend] ?? ''}`}>
      {labels[trend] ?? trend}
    </span>
  )
}

export function PurchaseHistorySection({
  companyId,
}: {
  companyId: string
}) {
  const t = useT()
  const [data, setData] = React.useState<PurchaseHistoryData | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)

  const loadData = React.useCallback(async (pageNum: number) => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const result = await readApiResultOrThrow<PurchaseHistoryData>(
        `/api/customers/companies/${encodeURIComponent(companyId)}/purchase-history?page=${pageNum}&pageSize=20`,
      )
      setData(result)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('customers.companies.detail.purchaseHistory.loadError', 'Failed to load purchase history.'))
    } finally {
      setIsLoading(false)
    }
  }, [companyId, t])

  React.useEffect(() => {
    loadData(page).catch(() => {})
  }, [loadData, page])

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
        <p className="text-destructive">{loadError}</p>
        <Button size="sm" variant="outline" onClick={() => loadData(page)}>
          {t('customers.companies.detail.purchaseHistory.retry', 'Retry')}
        </Button>
      </div>
    )
  }

  if (!data || (data.summary.totalOrders === 0 && data.orders.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
        <p>{t('customers.companies.detail.purchaseHistory.empty', 'No purchase history found.')}</p>
      </div>
    )
  }

  const formatCurrency = (value: string | number | null) => {
    if (value === null) return '—'
    const num = typeof value === 'string' ? parseFloat(value) : value
    if (Number.isNaN(num)) return '—'
    return new Intl.NumberFormat(undefined, {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    try {
      return new Date(dateStr).toLocaleDateString()
    } catch {
      return '—'
    }
  }

  const totalPages = Math.ceil(data.pagination.total / data.pagination.pageSize)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">
          {t('customers.companies.detail.purchaseHistory.summary', 'Summary')}
        </h3>
        <TrendBadge trend={data.purchaseTrend} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label={t('customers.companies.detail.purchaseHistory.avgMonthly', 'Avg monthly')}
          value={formatCurrency(data.summary.avgMonthlyRevenue)}
        />
        <SummaryCard
          label={t('customers.companies.detail.purchaseHistory.avgOrder', 'Avg order')}
          value={formatCurrency(data.summary.averageOrderValue)}
        />
        <SummaryCard
          label={t('customers.companies.detail.purchaseHistory.frequency', 'Orders/month')}
          value={data.summary.frequency.toFixed(1)}
        />
        <SummaryCard
          label={t('customers.companies.detail.purchaseHistory.lastOrder', 'Last order')}
          value={formatDate(data.summary.lastOrderDate)}
        />
      </div>

      {data.topProducts.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            {t('customers.companies.detail.purchaseHistory.topProducts', 'Top products')}
          </h3>
          <div className="divide-y rounded-lg border">
            {data.topProducts.map((product, index) => (
              <div key={`${product.name}-${index}`} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{product.name}</span>
                <div className="flex gap-4 text-muted-foreground">
                  <span>{product.quantity}x</span>
                  <span>{formatCurrency(product.totalSpent)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">
          {t('customers.companies.detail.purchaseHistory.orders', 'Order history')}
          <span className="ml-1 text-xs font-normal text-muted-foreground">({data.pagination.total})</span>
        </h3>
        <div className="divide-y overflow-hidden rounded-lg border">
          <div className="grid grid-cols-5 gap-2 bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>{t('customers.companies.detail.purchaseHistory.orderNumber', 'Order #')}</span>
            <span>{t('customers.companies.detail.purchaseHistory.date', 'Date')}</span>
            <span>{t('customers.companies.detail.purchaseHistory.amount', 'Amount')}</span>
            <span>{t('customers.companies.detail.purchaseHistory.currency', 'Currency')}</span>
            <span>{t('customers.companies.detail.purchaseHistory.status', 'Status')}</span>
          </div>
          {data.orders.map((order) => (
            <div key={order.id} className="grid grid-cols-5 gap-2 px-3 py-2 text-sm">
              <span className="font-medium">
                {order.orderNumber ? (
                  <Link
                    href={`/backend/sales/orders/${order.id}`}
                    className="text-primary hover:underline"
                  >
                    {order.orderNumber}
                  </Link>
                ) : (
                  order.id.slice(0, 8)
                )}
              </span>
              <span className="text-muted-foreground">{formatDate(order.createdAt)}</span>
              <span className="tabular-nums">{formatCurrency(order.totalAmount)}</span>
              <span className="text-muted-foreground">{order.currency ?? '—'}</span>
              <span>{order.status ?? '—'}</span>
            </div>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              {t('customers.companies.detail.purchaseHistory.prev', 'Previous')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              {t('customers.companies.detail.purchaseHistory.next', 'Next')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
