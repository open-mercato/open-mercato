'use client'

import * as React from 'react'
import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrderItemsInjectionContext } from '@open-mercato/core/modules/sales/widgets/injection/order-items-context'

type WmsStockEntry = {
  catalogVariantId: string
  available: string
  reserved: string
}

type WmsOrderListResponse = {
  items?: Array<{
    _wms?: {
      stockSummary?: WmsStockEntry[]
    }
  }>
}

const CACHE_TTL_MS = 60_000

type CacheEntry = {
  data: WmsStockEntry[]
  fetchedAt: number
}

const orderStockCache = new Map<string, CacheEntry>()
const pendingFetches = new Map<string, Promise<void>>()

function getCachedStock(documentId: string): WmsStockEntry[] | null {
  const entry = orderStockCache.get(documentId)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    orderStockCache.delete(documentId)
    return null
  }
  return entry.data
}

async function fetchOrderStock(documentId: string): Promise<void> {
  if (getCachedStock(documentId) !== null) return
  if (pendingFetches.has(documentId)) return pendingFetches.get(documentId)

  const promise = apiCall<WmsOrderListResponse>(`/api/sales/orders?id=${documentId}`)
    .then((res) => {
      const summary = res.result?.items?.[0]?._wms?.stockSummary ?? []
      orderStockCache.set(documentId, { data: summary, fetchedAt: Date.now() })
    })
    .catch(() => {
      orderStockCache.set(documentId, { data: [], fetchedAt: Date.now() })
    })
    .finally(() => {
      pendingFetches.delete(documentId)
    })

  pendingFetches.set(documentId, promise)
  return promise
}

function WmsOrderItemStockCell({ getValue }: { getValue: () => unknown }) {
  const t = useT()
  const ctx = useOrderItemsInjectionContext()
  const variantId = getValue() as string | null

  const [stock, setStock] = React.useState<WmsStockEntry | null | undefined>(
    () => {
      if (!variantId || !ctx?.documentId) return undefined
      const summary = getCachedStock(ctx.documentId)
      if (!summary) return undefined
      return summary.find((e) => e.catalogVariantId === variantId) ?? null
    },
  )

  React.useEffect(() => {
    if (!variantId || !ctx?.documentId) return
    const documentId = ctx.documentId

    const cached = getCachedStock(documentId)
    if (cached) {
      setStock(cached.find((e) => e.catalogVariantId === variantId) ?? null)
      return
    }

    let cancelled = false
    void fetchOrderStock(documentId).then(() => {
      if (cancelled) return
      const summary = getCachedStock(documentId) ?? []
      setStock(summary.find((e) => e.catalogVariantId === variantId) ?? null)
    })

    return () => {
      cancelled = true
    }
  }, [variantId, ctx?.documentId])

  if (!variantId || ctx?.kind !== 'order') return null

  if (stock === undefined) {
    return (
      <span className="text-xs text-muted-foreground">
        {t('wms.widgets.sales.orderItems.stockColumn.loading', '…')}
      </span>
    )
  }

  if (stock === null) {
    return (
      <span className="text-xs text-muted-foreground">
        {t('wms.widgets.sales.orderItems.stockColumn.noData', '—')}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className="font-medium tabular-nums">
        {stock.available}{' '}
        <span className="font-normal text-muted-foreground">
          {t('wms.widgets.sales.orderItems.stockColumn.available', 'avail.')}
        </span>
      </span>
      {Number(stock.reserved) > 0 && (
        <span className="text-muted-foreground tabular-nums">
          {stock.reserved}{' '}
          {t('wms.widgets.sales.orderItems.stockColumn.reserved', 'reserved')}
        </span>
      )}
    </div>
  )
}

const widget: InjectionColumnWidget = {
  metadata: {
    id: 'wms.injection.order-items-stock-column',
    priority: 50,
    features: ['wms.view'],
  },
  columns: [
    {
      id: 'wms_warehouse_stock',
      headerKey: 'wms.widgets.sales.orderItems.stockColumn.header',
      header: 'Warehouse Stock',
      accessorKey: 'productVariantId',
      sortable: false,
      cell: WmsOrderItemStockCell,
    },
  ],
}

export default widget
