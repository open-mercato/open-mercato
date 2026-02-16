"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DEFAULT_SETTINGS, hydrateSalesNewQuotesSettings, type DatePeriodOption, type SalesNewQuotesSettings } from './config'
import { formatRelativeTime } from '@open-mercato/ui/backend/detail'

type NewQuoteItem = {
  id: string
  quoteNumber: string
  status: string | null
  customerName: string | null
  customerEntityId: string | null
  netAmount: string
  grossAmount: string
  currency: string | null
  createdAt: string
  validFrom: string | null
  validUntil: string | null
  convertedOrderId: string | null
}

type NewQuotesApiPayload = {
  items?: unknown[]
  error?: string
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function parseNewQuoteItems(payload: NewQuotesApiPayload | null): NewQuoteItem[] {
  const rawItems = Array.isArray(payload?.items) ? payload?.items : []
  return rawItems
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const data = item as Record<string, unknown>
      const id = readString(data.id)
      const quoteNumber = readString(data.quoteNumber)
      const createdAt = readString(data.createdAt)
      if (!id || !quoteNumber || !createdAt) return null
      return {
        id,
        quoteNumber,
        status: readString(data.status),
        customerName: readString(data.customerName),
        customerEntityId: readString(data.customerEntityId),
        netAmount: readString(data.netAmount) ?? '0',
        grossAmount: readString(data.grossAmount) ?? '0',
        currency: readString(data.currency),
        createdAt,
        validFrom: readString(data.validFrom),
        validUntil: readString(data.validUntil),
        convertedOrderId: readString(data.convertedOrderId),
      }
    })
    .filter((item): item is NewQuoteItem => !!item)
}

async function loadNewQuotes(settings: SalesNewQuotesSettings): Promise<NewQuoteItem[]> {
  const params = new URLSearchParams({
    limit: String(settings.pageSize),
    datePeriod: settings.datePeriod,
  })
  if (settings.datePeriod === 'custom') {
    if (settings.customFrom) params.set('customFrom', settings.customFrom)
    if (settings.customTo) params.set('customTo', settings.customTo)
  }

  const call = await apiCall<NewQuotesApiPayload>(`/api/sales/dashboard/widgets/new-quotes?${params.toString()}`)
  if (!call.ok) {
    const message =
      typeof (call.result as Record<string, unknown> | null)?.error === 'string'
        ? ((call.result as Record<string, unknown>).error as string)
        : `Request failed with status ${call.status}`
    throw new Error(message)
  }
  return parseNewQuoteItems(call.result ?? null)
}

function resolveDetailHref(item: NewQuoteItem): string | null {
  return item.id ? `/backend/sales/quotes/${encodeURIComponent(item.id)}` : null
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const year = String(parsed.getFullYear())
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function openNativeDatePicker(event: React.SyntheticEvent<HTMLInputElement>) {
  const input = event.currentTarget
  if (typeof input.showPicker === 'function') {
    input.showPicker()
  }
}

function formatAmount(value: string, currency: string | null, locale?: string): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  try {
    if (currency && currency.trim().length > 0) {
      return new Intl.NumberFormat(locale ?? undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(numeric)
    }
    return new Intl.NumberFormat(locale ?? undefined, {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(numeric)
  } catch {
    return String(numeric)
  }
}


const SalesNewQuotesWidget: React.FC<DashboardWidgetComponentProps<SalesNewQuotesSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const translate = useT()
  const hydrated = React.useMemo(() => hydrateSalesNewQuotesSettings(settings), [settings])
  const [items, setItems] = React.useState<NewQuoteItem[]>([])
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
      const data = await loadNewQuotes(hydrated)
      setItems(data)
    } catch (err) {
      console.error('Failed to load new quotes widget data', err)
      setError(translate('sales.widgets.newQuotes.error', 'Failed to load quotes'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [hydrated, onRefreshStateChange, translate])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <label htmlFor="sales-new-quotes-page-size" className="text-xs font-semibold uppercase text-muted-foreground">
            {translate('sales.widgets.newQuotes.settings.pageSize', 'Number of Quotes')}
          </label>
          <input
            id="sales-new-quotes-page-size"
            type="number"
            min={1}
            max={20}
            className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={hydrated.pageSize}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (!Number.isFinite(next)) return
              const clamped = Math.min(20, Math.max(1, Math.floor(next)))
              onSettingsChange?.({ ...hydrated, pageSize: clamped })
            }}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="sales-new-quotes-date-period" className="text-xs font-semibold uppercase text-muted-foreground">
            {translate('sales.widgets.newQuotes.settings.datePeriod', 'Date Period')}
          </label>
          <select
            id="sales-new-quotes-date-period"
            value={hydrated.datePeriod}
            onChange={(event) => {
              onSettingsChange?.({ ...hydrated, datePeriod: event.target.value as DatePeriodOption })
            }}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="last24h">{translate('sales.widgets.newQuotes.settings.last24h', 'Last 24 hours')}</option>
            <option value="last7d">{translate('sales.widgets.newQuotes.settings.last7d', 'Last 7 days')}</option>
            <option value="last30d">{translate('sales.widgets.newQuotes.settings.last30d', 'Last 30 days')}</option>
            <option value="custom">{translate('sales.widgets.newQuotes.settings.custom', 'Custom range')}</option>
          </select>
        </div>

        {hydrated.datePeriod === 'custom' ? (
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <label htmlFor="sales-new-quotes-custom-from" className="text-xs font-semibold uppercase text-muted-foreground">
                {translate('sales.widgets.newQuotes.settings.customFrom', 'From')}
              </label>
              <input
                id="sales-new-quotes-custom-from"
                type="date"
                value={toDateInputValue(hydrated.customFrom)}
                onChange={(event) => {
                  onSettingsChange?.({ ...hydrated, customFrom: event.target.value })
                }}
                onFocus={openNativeDatePicker}
                onClick={openNativeDatePicker}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="sales-new-quotes-custom-to" className="text-xs font-semibold uppercase text-muted-foreground">
                {translate('sales.widgets.newQuotes.settings.customTo', 'To')}
              </label>
              <input
                id="sales-new-quotes-custom-to"
                type="date"
                value={toDateInputValue(hydrated.customTo)}
                onChange={(event) => {
                  onSettingsChange?.({ ...hydrated, customTo: event.target.value })
                }}
                onFocus={openNativeDatePicker}
                onClick={openNativeDatePicker}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
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

  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{translate('sales.widgets.newQuotes.empty', 'No quotes found')}</p>
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const detailHref = resolveDetailHref(item)
        const amountLabel = formatAmount(item.grossAmount, item.currency, locale)
        const createdLabel = formatRelativeTime(item.createdAt) ?? ''
        return (
          <li key={item.id} className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {detailHref ? (
                    <Link href={detailHref} className="text-sm font-semibold text-foreground hover:underline">
                      {item.quoteNumber}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-foreground">{item.quoteNumber}</span>
                  )}
                  {item.status ? (
                    <Badge variant="outline" className="text-xs">
                      {item.status}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {item.customerName ?? translate('sales.widgets.newQuotes.noCustomer', 'No customer')}
                </p>
                <p className="text-xs text-muted-foreground">{createdLabel}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{amountLabel}</p>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default SalesNewQuotesWidget
