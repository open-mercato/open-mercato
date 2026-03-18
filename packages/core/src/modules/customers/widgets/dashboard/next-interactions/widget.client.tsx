"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DEFAULT_SETTINGS,
  hydrateNextInteractionsSettings,
  type CustomerNextInteractionsSettings,
} from './config'
import { renderDictionaryColor, renderDictionaryIcon } from '../../../lib/dictionaries'

type NextInteractionItem = {
  id: string
  displayName: string | null
  kind: string | null
  nextInteractionAt: string | null
  nextInteractionName: string | null
  nextInteractionIcon: string | null
  nextInteractionColor: string | null
  organizationId: string | null
}

type ApiResponse = {
  items: NextInteractionItem[]
  now?: string
}

async function loadNextInteractions(settings: CustomerNextInteractionsSettings): Promise<ApiResponse> {
  const params = new URLSearchParams({
    limit: String(settings.pageSize),
    includePast: settings.includePast ? 'true' : 'false',
  })
  const call = await apiCall<ApiResponse>(`/api/customers/dashboard/widgets/next-interactions?${params.toString()}`)
  if (!call.ok) {
    const rawError = (call.result as Record<string, unknown> | null)?.error
    const message =
      typeof rawError === 'string'
        ? rawError
        : `Request failed with status ${call.status}`
    throw new Error(message)
  }
  const payloadData = (call.result ?? {}) as Record<string, unknown>
  const now = typeof payloadData.now === 'string' ? payloadData.now : undefined
  const rawItems = Array.isArray(payloadData.items) ? payloadData.items : []
  const items = rawItems
    .map((item): NextInteractionItem | null => {
      if (!item || typeof item !== 'object') return null
      const data = item as Record<string, unknown>
      const id = typeof data.id === 'string' ? data.id : null
      if (!id) return null
      return {
        id,
        displayName: typeof data.displayName === 'string' ? data.displayName : null,
        kind: typeof data.kind === 'string' ? data.kind : null,
        nextInteractionAt: typeof data.nextInteractionAt === 'string' ? data.nextInteractionAt : null,
        nextInteractionName: typeof data.nextInteractionName === 'string' ? data.nextInteractionName : null,
        nextInteractionIcon: typeof data.nextInteractionIcon === 'string' ? data.nextInteractionIcon : null,
        nextInteractionColor: typeof data.nextInteractionColor === 'string' ? data.nextInteractionColor : null,
        organizationId: typeof data.organizationId === 'string' ? data.organizationId : null,
      }
    })
    .filter((item): item is NextInteractionItem => !!item && !!item.id)

  return { items, now }
}

function resolveDetailHref(item: NextInteractionItem): string | null {
  if (!item.id || !item.kind) return null
  if (item.kind === 'company') return `/backend/customers/companies/${encodeURIComponent(item.id)}`
  if (item.kind === 'person') return `/backend/customers/people/${encodeURIComponent(item.id)}`
  return null
}

function formatAbsolute(value: string | null, locale?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale ?? undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

const CustomerNextInteractionsWidget: React.FC<DashboardWidgetComponentProps<CustomerNextInteractionsSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateNextInteractionsSettings(settings), [settings])
  const [data, setData] = React.useState<NextInteractionItem[]>([])
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
      const response = await loadNextInteractions(hydrated)
      setData(response.items)
    } catch (err) {
      console.error('Failed to load next interactions widget data', err)
      setError(t('customers.widgets.nextInteractions.error'))
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
          <label htmlFor="customer-next-interactions-page-size" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('customers.widgets.nextInteractions.settings.pageSize')}
          </label>
          <input
            id="customer-next-interactions-page-size"
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
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={hydrated.includePast}
            onChange={(event) => onSettingsChange({ ...hydrated, includePast: event.target.checked })}
          />
          {t('customers.widgets.nextInteractions.settings.includePast')}
        </label>
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
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('customers.widgets.nextInteractions.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {data.map((item) => {
            const href = resolveDetailHref(item)
            const absolute = formatAbsolute(item.nextInteractionAt, locale)
            const relative = formatRelativeTime(item.nextInteractionAt, { locale }) ?? ''
            return (
              <li key={item.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {item.nextInteractionIcon ? (
                      <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-card">
                        {renderDictionaryIcon(item.nextInteractionIcon, 'h-4 w-4')}
                      </span>
                    ) : null}
                    <div>
                      <p className="text-sm font-medium">{item.displayName ?? t('customers.widgets.common.unknown')}</p>
                      {item.nextInteractionName ? (
                        <p className="text-xs text-muted-foreground">{item.nextInteractionName}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-right text-xs text-muted-foreground">
                    <div>
                      <p>{absolute || t('customers.widgets.common.unknownDate')}</p>
                      {relative ? <p>{relative}</p> : null}
                    </div>
                    {item.nextInteractionColor
                      ? renderDictionaryColor(item.nextInteractionColor, 'h-3 w-3 rounded-full border border-border')
                      : null}
                  </div>
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

export default CustomerNextInteractionsWidget
