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
  hydrateSalesNewQuotesSettings,
  type SalesNewQuotesSettings,
} from './config'
import type { DatePeriodOption } from '../../../lib/dateRange'

type QuoteItem = {
  id: string
  quoteNumber: string
  status: string | null
  customerName: string | null
  customerEntityId: string | null
  validFrom: string | null
  validUntil: string | null
  netAmount: string
  grossAmount: string
  currency: string | null
  createdAt: string
  convertedOrderId: string | null
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

function formatDate(value: string | null, locale?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(locale ?? undefined, { dateStyle: 'medium' })
}

async function loadQuotes(settings: SalesNewQuotesSettings): Promise<QuoteItem[]> {
  const params = new URLSearchParams({
    limit: String(settings.pageSize),
    datePeriod: settings.datePeriod,
  })
  if (settings.datePeriod === 'custom') {
    if (settings.customFrom) params.set('customFrom', settings.customFrom)
    if (settings.customTo) params.set('customTo', settings.customTo)
  }
  const call = await apiCall<{ items?: unknown[]; error?: string }>(
    `/api/sales/dashboard/widgets/new-quotes?${params.toString()}`,
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
    .map((item: unknown): QuoteItem | null => {
      if (!item || typeof item !== 'object') return null
      const data = item as Record<string, unknown>
      if (typeof data.id !== 'string' || typeof data.createdAt !== 'string') return null
      const netAmount = data.netAmount
      const grossAmount = data.grossAmount
      return {
        id: data.id,
        quoteNumber: typeof data.quoteNumber === 'string' ? data.quoteNumber : '',
        status: typeof data.status === 'string' ? data.status : null,
        customerName: typeof data.customerName === 'string' ? data.customerName : null,
        customerEntityId: typeof data.customerEntityId === 'string' ? data.customerEntityId : null,
        validFrom: typeof data.validFrom === 'string' ? data.validFrom : null,
        validUntil: typeof data.validUntil === 'string' ? data.validUntil : null,
        netAmount: typeof netAmount === 'string' ? netAmount : typeof netAmount === 'number' ? String(netAmount) : '0',
        grossAmount:
          typeof grossAmount === 'string' ? grossAmount : typeof grossAmount === 'number' ? String(grossAmount) : '0',
        currency: typeof data.currency === 'string' ? data.currency : null,
        createdAt: data.createdAt,
        convertedOrderId: typeof data.convertedOrderId === 'string' ? data.convertedOrderId : null,
      }
    })
    .filter((item: QuoteItem | null): item is QuoteItem => !!item)
}

const SalesNewQuotesWidget: React.FC<DashboardWidgetComponentProps<SalesNewQuotesSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSalesNewQuotesSettings(settings), [settings])
  const [items, setItems] = React.useState<QuoteItem[]>([])
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
      const data = await loadQuotes(hydrated)
      setItems(data)
    } catch (err) {
      console.error('Failed to load new quotes widget data', err)
      setError(t('sales.widgets.newQuotes.error', 'Failed to load quotes'))
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
            htmlFor="sales-new-quotes-page-size"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('sales.widgets.newQuotes.settings.pageSize', 'Number of Quotes')}
          </label>
          <input
            id="sales-new-quotes-page-size"
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
            htmlFor="sales-new-quotes-date-period"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('sales.widgets.newQuotes.settings.datePeriod', 'Date Period')}
          </label>
          <select
            id="sales-new-quotes-date-period"
            className="w-full rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={hydrated.datePeriod}
            onChange={(event) => {
              onSettingsChange({ ...hydrated, datePeriod: event.target.value as DatePeriodOption })
            }}
          >
            <option value="last24h">{t('sales.widgets.newQuotes.settings.last24h', 'Last 24 hours')}</option>
            <option value="last7d">{t('sales.widgets.newQuotes.settings.last7d', 'Last 7 days')}</option>
            <option value="last30d">{t('sales.widgets.newQuotes.settings.last30d', 'Last 30 days')}</option>
            <option value="custom">{t('sales.widgets.newQuotes.settings.custom', 'Custom range')}</option>
          </select>
        </div>
        {hydrated.datePeriod === 'custom' ? (
          <>
            <div className="space-y-1.5">
              <label
                htmlFor="sales-new-quotes-custom-from"
                className="text-xs font-semibold uppercase text-muted-foreground"
              >
                {t('sales.widgets.newQuotes.settings.customFrom', 'From')}
              </label>
              <input
                id="sales-new-quotes-custom-from"
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
                htmlFor="sales-new-quotes-custom-to"
                className="text-xs font-semibold uppercase text-muted-foreground"
              >
                {t('sales.widgets.newQuotes.settings.customTo', 'To')}
              </label>
              <input
                id="sales-new-quotes-custom-to"
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
        {t('sales.widgets.newQuotes.empty', 'No quotes found in this period')}
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {items.map((quote) => {
        const createdLabel = formatRelativeDate(quote.createdAt, locale)
        const validUntilLabel = formatDate(quote.validUntil, locale)
        const isExpired = quote.validUntil ? new Date(quote.validUntil) < new Date() : false
        return (
          <li key={quote.id} className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="text-sm font-medium text-foreground hover:underline"
                    href={`/backend/sales/quotes/${encodeURIComponent(quote.id)}`}
                  >
                    {quote.quoteNumber}
                  </Link>
                  {quote.status ? (
                    <Badge variant="outline" className="text-[11px]">
                      {quote.status}
                    </Badge>
                  ) : null}
                  {quote.convertedOrderId ? (
                    <Badge variant="secondary" className="text-[11px]">
                      {t('sales.widgets.newQuotes.converted', 'Converted')}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {quote.customerName ?? t('sales.widgets.newQuotes.noCustomer', 'No customer')}
                </p>
                {validUntilLabel ? (
                  <p
                    className={`text-xs ${isExpired ? 'text-muted-foreground line-through' : 'text-muted-foreground'}`}
                  >
                    {t('sales.widgets.newQuotes.validUntil', 'Valid until {{date}}', { date: validUntilLabel })}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {createdLabel || t('sales.widgets.newQuotes.unknownDate', 'Unknown date')}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">
                  {formatCurrency(quote.grossAmount, quote.currency, locale)}
                </p>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default SalesNewQuotesWidget
