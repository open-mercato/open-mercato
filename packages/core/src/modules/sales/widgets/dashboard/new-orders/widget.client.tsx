"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DEFAULT_SETTINGS,
  hydrateSalesNewOrdersSettings,
  type SalesNewOrdersSettings,
} from './config'
import type { DatePeriodOption } from '../../../lib/dateRange'

type OrderItem = {
  id: string
  orderNumber: string
  status: string | null
  fulfillmentStatus: string | null
  paymentStatus: string | null
  customerName: string | null
  customerEntityId: string | null
  netAmount: string
  grossAmount: string
  currency: string | null
  createdAt: string
}

function formatCurrency(value: string | null, currency: string | null, locale?: string): string {
  const amount = typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(amount)) return '—'
  const code = currency || 'USD'
  try {
    return new Intl.NumberFormat(locale ?? undefined, { style: 'currency', currency: code }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${code}`
  }
}

function formatRelativeDate(value: string, locale?: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const absMs = Math.abs(diffMs)
  const rtf = new Intl.RelativeTimeFormat(locale ?? undefined, { numeric: 'auto' })
  if (absMs < 60 * 1000) {
    return rtf.format(Math.round(diffMs / 1000), 'second')
  }
  if (absMs < 60 * 60 * 1000) {
    return rtf.format(Math.round(diffMs / (60 * 1000)), 'minute')
  }
  if (absMs < 24 * 60 * 60 * 1000) {
    return rtf.format(Math.round(diffMs / (60 * 60 * 1000)), 'hour')
  }
  return rtf.format(Math.round(diffMs / (24 * 60 * 60 * 1000)), 'day')
}

async function loadOrders(settings: SalesNewOrdersSettings): Promise<OrderItem[]> {
  const params = new URLSearchParams({
    limit: String(settings.pageSize),
    datePeriod: settings.datePeriod,
  })
  if (settings.datePeriod === 'custom') {
    if (settings.customFrom) params.set('customFrom', settings.customFrom)
    if (settings.customTo) params.set('customTo', settings.customTo)
  }
  const call = await apiCall<{ items?: unknown[]; error?: string }>(
    `/api/sales/dashboard/widgets/new-orders?${params.toString()}`,
  )
  if (!call.ok) {
    const message =
      typeof (call.result as Record<string, unknown> | null)?.error === 'string'
        ? ((call.result as Record<string, unknown>).error as string)
        : `Request failed with status ${call.status}`
    throw new Error(message)
  }
  const payload = call.result ?? {}
  const rawItems = Array.isArray((payload as { items?: unknown[] }).items)
    ? (payload as { items: unknown[] }).items
    : []
  return rawItems
    .map((item: unknown): OrderItem | null => {
      if (!item || typeof item !== 'object') return null
      const data = item as any
      return {
        id: typeof data.id === 'string' ? data.id : null,
        orderNumber: typeof data.orderNumber === 'string' ? data.orderNumber : '',
        status: typeof data.status === 'string' ? data.status : null,
        fulfillmentStatus: typeof data.fulfillmentStatus === 'string' ? data.fulfillmentStatus : null,
        paymentStatus: typeof data.paymentStatus === 'string' ? data.paymentStatus : null,
        customerName: typeof data.customerName === 'string' ? data.customerName : null,
        customerEntityId: typeof data.customerEntityId === 'string' ? data.customerEntityId : null,
        netAmount: typeof data.netAmount === 'string' ? data.netAmount : '0',
        grossAmount: typeof data.grossAmount === 'string' ? data.grossAmount : '0',
        currency: typeof data.currency === 'string' ? data.currency : null,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
      }
    })
    .filter((item: OrderItem | null): item is OrderItem => !!item && !!item.id && !!item.createdAt)
}

const SalesNewOrdersWidget: React.FC<DashboardWidgetComponentProps<SalesNewOrdersSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSalesNewOrdersSettings(settings), [settings])
  const [items, setItems] = React.useState<OrderItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [locale, setLocale] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setLocale(navigator.language)
    }
  }, [])

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const data = await loadOrders(hydrated)
      setItems(data)
    } catch (err) {
      console.error('Failed to load new orders widget data', err)
      setError(t('sales.widgets.newOrders.error', 'Failed to load orders'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [hydrated, onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <label
            htmlFor="sales-new-orders-page-size"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('sales.widgets.newOrders.settings.pageSize', 'Number of Orders')}
          </label>
          <input
            id="sales-new-orders-page-size"
            type="number"
            min={1}
            max={20}
            className="w-24 rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={hydrated.pageSize}
            onChange={(event) => {
              const next = Number(event.target.value)
              const value = Number.isFinite(next)
                ? Math.min(20, Math.max(1, Math.floor(next)))
                : hydrated.pageSize
              onSettingsChange({ ...hydrated, pageSize: value })
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="sales-new-orders-date-period"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('sales.widgets.newOrders.settings.datePeriod', 'Date Period')}
          </label>
          <select
            id="sales-new-orders-date-period"
            className="w-full rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={hydrated.datePeriod}
            onChange={(event) => {
              onSettingsChange({ ...hydrated, datePeriod: event.target.value as DatePeriodOption })
            }}
          >
            <option value="last24h">{t('sales.widgets.newOrders.settings.last24h', 'Last 24 hours')}</option>
            <option value="last7d">{t('sales.widgets.newOrders.settings.last7d', 'Last 7 days')}</option>
            <option value="last30d">{t('sales.widgets.newOrders.settings.last30d', 'Last 30 days')}</option>
            <option value="custom">{t('sales.widgets.newOrders.settings.custom', 'Custom range')}</option>
          </select>
        </div>
        {hydrated.datePeriod === 'custom' ? (
          <>
            <div className="space-y-1.5">
              <label
                htmlFor="sales-new-orders-custom-from"
                className="text-xs font-semibold uppercase text-muted-foreground"
              >
                {t('sales.widgets.newOrders.settings.customFrom', 'From')}
              </label>
              <input
                id="sales-new-orders-custom-from"
                type="date"
                className="w-full rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                value={hydrated.customFrom ?? ''}
                onChange={(event) => {
                  onSettingsChange({ ...hydrated, customFrom: event.target.value })
                }}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="sales-new-orders-custom-to"
                className="text-xs font-semibold uppercase text-muted-foreground"
              >
                {t('sales.widgets.newOrders.settings.customTo', 'To')}
              </label>
              <input
                id="sales-new-orders-custom-to"
                type="date"
                className="w-full rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                value={hydrated.customTo ?? ''}
                onChange={(event) => {
                  onSettingsChange({ ...hydrated, customTo: event.target.value })
                }}
              />
            </div>
          </>
        ) : null}
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('sales.widgets.newOrders.empty', 'No orders found in this period')}
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {items.map((order) => {
        const createdLabel = formatRelativeDate(order.createdAt, locale)
        return (
          <li key={order.id} className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Link
                    className="text-sm font-medium text-foreground hover:underline"
                    href={`/backend/sales/orders/${encodeURIComponent(order.id)}`}
                  >
                    {order.orderNumber}
                  </Link>
                  {order.status ? (
                    <Badge variant="outline" className="text-[11px]">
                      {order.status}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {order.customerName ?? t('sales.widgets.newOrders.noCustomer', 'No customer')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {createdLabel || t('sales.widgets.newOrders.unknownDate', 'Unknown date')}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">
                  {formatCurrency(order.grossAmount, order.currency, locale)}
                </p>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default SalesNewOrdersWidget
