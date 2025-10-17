"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DEFAULT_SETTINGS,
  hydrateNewCustomersSettings,
  type CustomerNewCustomersSettings,
} from './config'

type NewCustomerItem = {
  id: string
  displayName: string | null
  kind: string | null
  createdAt: string
}

async function loadNewCustomers(settings: CustomerNewCustomersSettings): Promise<NewCustomerItem[]> {
  const params = new URLSearchParams({
    limit: String(settings.pageSize),
  })
  if (settings.kind !== 'all') {
    params.set('kind', settings.kind)
  }
  const response = await apiFetch(`/api/customers/dashboard/widgets/new-customers?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }
  const payload = await response.json().catch(() => ({}))
  const rawItems = Array.isArray((payload as any).items) ? (payload as any).items : []
  return rawItems
    .map((item): NewCustomerItem | null => {
      if (!item || typeof item !== 'object') return null
      const data = item as any
      return {
        id: typeof data.id === 'string' ? data.id : null,
        displayName: typeof data.displayName === 'string' ? data.displayName : null,
        kind: typeof data.kind === 'string' ? data.kind : null,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
      }
    })
    .filter((item): item is NewCustomerItem => !!item && !!item.id && !!item.createdAt)
}

function resolveDetailHref(item: NewCustomerItem): string | null {
  if (!item.id || !item.kind) return null
  if (item.kind === 'company') return `/backend/customers/companies/${encodeURIComponent(item.id)}`
  if (item.kind === 'person') return `/backend/customers/people/${encodeURIComponent(item.id)}`
  return null
}

function formatDate(value: string | null, locale?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale ?? undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatKind(kind: string | null, t: (key: string) => string): string {
  if (kind === 'person') return t('customers.widgets.newCustomers.kind.person')
  if (kind === 'company') return t('customers.widgets.newCustomers.kind.company')
  return t('customers.widgets.newCustomers.kind.unknown')
}

const CustomerNewCustomersWidget: React.FC<DashboardWidgetComponentProps<CustomerNewCustomersSettings>> = ({
  mode,
  settings,
  onSettingsChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateNewCustomersSettings(settings), [settings])
  const [items, setItems] = React.useState<NewCustomerItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [locale, setLocale] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setLocale(navigator.language)
    }
  }, [])

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await loadNewCustomers(hydrated)
      setItems(data)
    } catch (err) {
      console.error('Failed to load new customers widget data', err)
      setError(t('customers.widgets.newCustomers.error'))
    } finally {
      setLoading(false)
    }
  }, [hydrated, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <label htmlFor="customer-new-customers-page-size" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('customers.widgets.newCustomers.settings.pageSize')}
          </label>
          <input
            id="customer-new-customers-page-size"
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
        <div className="space-y-1.5">
          <label htmlFor="customer-new-customers-kind" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('customers.widgets.newCustomers.settings.kind')}
          </label>
          <select
            id="customer-new-customers-kind"
            className="w-full rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={hydrated.kind}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'person' || value === 'company' || value === 'all') {
                onSettingsChange({ ...hydrated, kind: value })
              }
            }}
          >
            <option value="all">{t('customers.widgets.newCustomers.filters.all')}</option>
            <option value="person">{t('customers.widgets.newCustomers.filters.person')}</option>
            <option value="company">{t('customers.widgets.newCustomers.filters.company')}</option>
          </select>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={() => refresh().catch(() => {})} disabled={loading}>
          {loading ? <Spinner className="h-4 w-4" /> : t('customers.widgets.newCustomers.actions.refresh')}
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('customers.widgets.newCustomers.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const href = resolveDetailHref(item)
            const createdLabel = formatDate(item.createdAt, locale)
            return (
              <li key={item.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{item.displayName ?? t('customers.widgets.common.unknown')}</p>
                    <p className="text-xs text-muted-foreground">{formatKind(item.kind, t)}</p>
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

CustomerNewCustomersWidget.defaultProps = {
  settings: DEFAULT_SETTINGS,
}

export default CustomerNewCustomersWidget
