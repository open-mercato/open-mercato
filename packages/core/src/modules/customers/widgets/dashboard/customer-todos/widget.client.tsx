"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DEFAULT_SETTINGS, hydrateCustomerTodoSettings, type CustomerTodoWidgetSettings } from './config'

type TodoLinkSummary = {
  id: string
  todoId: string
  todoSource: string
  todoTitle: string | null
  createdAt: string
  entity: {
    id: string | null
    displayName: string | null
    kind: string | null
  }
}

async function loadTodos(settings: CustomerTodoWidgetSettings): Promise<TodoLinkSummary[]> {
  const params = new URLSearchParams({
    limit: String(settings.pageSize),
  })
  const call = await apiCall<{ items?: unknown[]; error?: string }>(
    `/api/customers/dashboard/widgets/customer-todos?${params.toString()}`,
  )
  if (!call.ok) {
    const message =
      typeof (call.result as Record<string, unknown> | null)?.error === 'string'
        ? ((call.result as Record<string, unknown>).error as string)
        : `Request failed with status ${call.status}`
    throw new Error(message)
  }
  const payload = call.result ?? {}
  const rawItems = Array.isArray((payload as { items?: unknown }).items)
    ? ((payload as { items: unknown[] }).items)
    : []
  return rawItems
    .map((item): TodoLinkSummary | null => {
      if (!item || typeof item !== 'object') return null
      const data = item as any
      const entity = data.entity ?? {}
      return {
        id: typeof data.id === 'string' ? data.id : null,
        todoId: typeof data.todoId === 'string' ? data.todoId : '',
        todoSource: typeof data.todoSource === 'string' ? data.todoSource : '',
        todoTitle: typeof data.todoTitle === 'string' ? data.todoTitle : null,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
        entity: {
          id: typeof entity.id === 'string' ? entity.id : null,
          displayName: typeof entity.displayName === 'string' ? entity.displayName : null,
          kind: typeof entity.kind === 'string' ? entity.kind : null,
        },
      }
    })
    .filter((item): item is TodoLinkSummary => !!item && !!item.id)
}

function formatDate(value: string | null, locale?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale ?? undefined)
}

function resolveDetailHref(entity: { id: string | null; kind: string | null }): string | null {
  if (!entity.id) return null
  if (entity.kind === 'company') return `/backend/customers/companies/${encodeURIComponent(entity.id)}`
  if (entity.kind === 'person') return `/backend/customers/people/${encodeURIComponent(entity.id)}`
  return `/backend/customers/people/${encodeURIComponent(entity.id)}`
}

const CustomerTodosWidget: React.FC<DashboardWidgetComponentProps<CustomerTodoWidgetSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateCustomerTodoSettings(settings), [settings])
  const [items, setItems] = React.useState<TodoLinkSummary[]>([])
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
      const data = await loadTodos(hydrated)
      setItems(data)
    } catch (err) {
      console.error('Failed to load customer todos widget data', err)
      setError(t('customers.widgets.todos.error'))
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
          <label htmlFor="customer-todos-page-size" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('customers.widgets.todos.settings.pageSize')}
          </label>
          <input
            id="customer-todos-page-size"
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
        <p className="text-xs text-muted-foreground">{t('customers.widgets.todos.settings.help')}</p>
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
        <p className="text-sm text-muted-foreground">{t('customers.widgets.todos.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const createdLabel = formatDate(item.createdAt, locale)
            const href = resolveDetailHref(item.entity)
            return (
              <li key={item.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3 text-sm font-medium">
                  <span>{item.entity.displayName ?? t('customers.widgets.common.unknown')}</span>
                  <span className="text-xs text-muted-foreground">{createdLabel || t('customers.widgets.common.unknownDate')}</span>
                </div>
                <div className="mt-1 space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {item.todoTitle ?? t('customers.widgets.todos.untitled')}
                  </p>
                  {item.todoSource ? (
                    <p className="text-xs text-muted-foreground">{item.todoSource}</p>
                  ) : null}
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

export default CustomerTodosWidget
