"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DEFAULT_SETTINGS, hydrateNewDealsSettings, type CustomerNewDealsSettings } from './config'

type NewDealItem = {
  id: string
  title: string | null
  status: string | null
  createdAt: string
}

async function loadNewDeals(settings: CustomerNewDealsSettings): Promise<NewDealItem[]> {
  const params = new URLSearchParams({ limit: String(settings.pageSize) })
  const call = await apiCall<{ items?: unknown[]; error?: string }>(
    `/api/customers/dashboard/widgets/new-deals?${params.toString()}`,
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
    .map((item: unknown): NewDealItem | null => {
      if (!item || typeof item !== 'object') return null
      const data = item as any
      return {
        id: typeof data.id === 'string' ? data.id : null,
        title: typeof data.title === 'string' ? data.title : null,
        status: typeof data.status === 'string' ? data.status : null,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
      }
    })
    .filter((item: NewDealItem | null): item is NewDealItem => !!item && !!item.id && !!item.createdAt)
}

function resolveDetailHref(item: NewDealItem): string | null {
  if (!item.id) return null
  return `/backend/customers/deals/${encodeURIComponent(item.id)}`
}

function formatDate(value: string | null, locale?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale ?? undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const CustomerNewDealsWidget: React.FC<DashboardWidgetComponentProps<CustomerNewDealsSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateNewDealsSettings(settings), [settings])
  const [items, setItems] = React.useState<NewDealItem[]>([])
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
      const data = await loadNewDeals(hydrated)
      setItems(data)
    } catch (err) {
      console.error('Failed to load new deals widget data', err)
      setError(t('customers.widgets.newDeals.error'))
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
          <label htmlFor="customer-new-deals-page-size" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('customers.widgets.newDeals.settings.pageSize')}
          </label>
          <input
            id="customer-new-deals-page-size"
            type="number"
            min={1}
            max={20}
            className="w-24 rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={hydrated.pageSize}
            onChange={(event) => {
              const next = Number(event.target.value)
              onSettingsChange({ ...hydrated, pageSize: Number.isFinite(next) ? next : hydrated.pageSize })
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('customers.widgets.newDeals.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const href = resolveDetailHref(item)
            const createdLabel = formatDate(item.createdAt, locale)
            return (
              <li key={item.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{item.title ?? t('customers.widgets.newDeals.untitled')}</p>
                    <p className="text-xs text-muted-foreground">{item.status ?? t('customers.widgets.common.unknown')}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{createdLabel || t('customers.widgets.common.unknownDate')}</p>
                </div>
                {href ? (
                  <div className="mt-2 text-xs">
                    <Link className="text-primary hover:underline" href={href}>
                      {t('customers.widgets.common.viewRecord')}
                    </Link>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default CustomerNewDealsWidget
