"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DEFAULT_SETTINGS, hydrateTasksActiveSettings, type ShipmentTasksActiveSettings } from './config'

type TaskItem = {
  id: string
  title: string | null
  description: string | null
  status: string
  shipmentId: string | null
  shipmentReference: string | null
  assignedToName: string | null
  createdAt: string | null
}

async function loadActiveShipmentTasks(settings: ShipmentTasksActiveSettings): Promise<TaskItem[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(settings.pageSize),
    status: 'TODO,IN_PROGRESS',
    sortBy: 'createdAt',
    sortOrder: 'asc',
  })
  const call = await apiCall<{ items?: unknown[]; error?: string }>(`/api/shipments/tasks?${params.toString()}`)
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
    .map((item): TaskItem | null => {
      if (!item || typeof item !== 'object') return null
      const data = item as any
      return {
        id: typeof data.id === 'string' ? data.id : null,
        title: typeof data.title === 'string' ? data.title : null,
        description: typeof data.description === 'string' ? data.description : null,
        status: typeof data.status === 'string' ? data.status : 'TODO',
        shipmentId: typeof data.shipmentId === 'string' ? data.shipmentId : null,
        shipmentReference: data.shipment?.internalReference ?? data.shipment?.containerNumber ?? null,
        assignedToName: data.assignedTo?.name ?? data.assignedTo?.email ?? null,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
      }
    })
    .filter((item): item is TaskItem => !!item && !!item.id)
}

function formatDate(value: string | null, locale?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale ?? undefined, { dateStyle: 'medium' })
}

function formatStatus(status: string): string {
  return status === 'IN_PROGRESS' ? 'In Progress' : status.charAt(0) + status.slice(1).toLowerCase()
}

const ShipmentTasksActiveWidget: React.FC<DashboardWidgetComponentProps<ShipmentTasksActiveSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateTasksActiveSettings(settings), [settings])
  const [items, setItems] = React.useState<TaskItem[]>([])
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
      const data = await loadActiveShipmentTasks(hydrated)
      setItems(data)
    } catch (err) {
      console.error('Failed to load active shipment tasks widget data', err)
      setError('Failed to load tasks')
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [hydrated, onRefreshStateChange])

  React.useEffect(() => {
    refresh().catch(() => { })
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <label htmlFor="shipment-tasks-active-page-size" className="text-xs font-semibold uppercase text-muted-foreground">
            Items to display
          </label>
          <input
            id="shipment-tasks-active-page-size"
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
        <p className="text-sm text-muted-foreground">No active tasks</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const href = item.shipmentId ? `/backend/shipments/${encodeURIComponent(item.shipmentId)}` : '#'
            const createdDate = formatDate(item.createdAt, locale)
            return (
              <li key={item.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.title || 'Untitled Task'}</p>
                    {item.description ? (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                    ) : null}
                  </div>
                  <span className="text-xs rounded-full bg-blue-100 px-2 py-1 text-blue-700">
                    {formatStatus(item.status)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                  {item.shipmentReference ? (
                    <span>Shipment: {item.shipmentReference}</span>
                  ) : null}
                  {item.assignedToName ? (
                    <span>Assigned to: {item.assignedToName}</span>
                  ) : null}
                  {createdDate ? <span>Created {createdDate}</span> : null}
                </div>
                <div className="mt-2 text-xs">
                  <Link className="text-primary hover:underline" href={href}>
                    View Shipment
                  </Link>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default ShipmentTasksActiveWidget