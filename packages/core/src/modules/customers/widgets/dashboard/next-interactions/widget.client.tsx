"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DEFAULT_SETTINGS,
  hydrateNextInteractionsSettings,
  type CustomerNextInteractionsSettings,
} from './config'
import { renderDictionaryColor, renderDictionaryIcon } from '../../../components/dictionaryAppearance'

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
  const response = await apiFetch(`/api/customers/dashboard/widgets/next-interactions?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }
  const payload = await response.json().catch(() => ({}))
  const now = typeof (payload as any).now === 'string' ? (payload as any).now : undefined
  const rawItems = Array.isArray((payload as any).items) ? (payload as any).items : []
  const items = rawItems
    .map((item): NextInteractionItem | null => {
      if (!item || typeof item !== 'object') return null
      const data = item as any
      return {
        id: typeof data.id === 'string' ? data.id : null,
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

function formatRelative(target: string | null, nowIso: string | undefined, locale: string | undefined): string {
  if (!target) return ''
  const targetDate = new Date(target)
  const nowDate = nowIso ? new Date(nowIso) : new Date()
  if (Number.isNaN(targetDate.getTime()) || Number.isNaN(nowDate.getTime())) return ''
  const diffMs = targetDate.getTime() - nowDate.getTime()
  const diffMinutes = Math.round(diffMs / (60 * 1000))
  const absMinutes = Math.abs(diffMinutes)
  const rtf = typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat !== 'undefined'
    ? new Intl.RelativeTimeFormat(locale ?? undefined, { numeric: 'auto' })
    : null

  if (!rtf) {
    return formatAbsolute(target, locale)
  }

  if (absMinutes < 60) {
    return rtf.format(diffMinutes, 'minute')
  }
  if (absMinutes < 60 * 24) {
    return rtf.format(Math.round(diffMinutes / 60), 'hour')
  }
  if (absMinutes < 60 * 24 * 7) {
    return rtf.format(Math.round(diffMinutes / (60 * 24)), 'day')
  }
  return rtf.format(Math.round(diffMinutes / (60 * 24 * 7)), 'week')
}

const CustomerNextInteractionsWidget: React.FC<DashboardWidgetComponentProps<CustomerNextInteractionsSettings>> = ({
  mode,
  settings,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateNextInteractionsSettings(settings), [settings])
  const [data, setData] = React.useState<NextInteractionItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [now, setNow] = React.useState<string | undefined>(undefined)
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
      setNow(response.now)
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
            const relative = formatRelative(item.nextInteractionAt, now, locale)
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

CustomerNextInteractionsWidget.defaultProps = {
  settings: DEFAULT_SETTINGS,
}

export default CustomerNextInteractionsWidget
